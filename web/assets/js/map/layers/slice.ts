import {
  ActionReducerMapBuilder,
  createSelector,
  createSlice,
  PayloadAction,
} from '@reduxjs/toolkit';
import sortBy from '../util/sortBy';
import { RootState } from '../store/type';
import { Layer, LayerDatas, Layers, LayerSource, LayerSources } from './types';
import { idxBetween } from '../features/fracIdx';
import { syncData } from '../sync/slice';

export interface State {
  datas: LayerDatas;
  sources: LayerSources;
  sync: {
    layers: Layers;
    is3d: boolean;
  };
}

const initialState: State = {
  datas: {},
  sources: {},
  sync: {
    layers: {},
    is3d: false,
  },
};

const slice = createSlice({
  name: 'layers',
  initialState,
  reducers: {
    updateLayer(
      state,
      { payload }: PayloadAction<{ sourceId: string; value: Partial<Layer> }>,
    ) {
      const layer = state.sync.layers[payload.sourceId];
      if (!layer) {
        console.error('Cannot update nonexistant layer');
        return;
      }
      for (const prop in payload.value) {
        if (prop === 'sourceId') throw new Error('Cannot update sourceId');
        layer[prop] = payload.value[prop];
      }
    },
    removeLayer(state, { payload }: PayloadAction<string>) {
      delete state.sync.layers[payload];
    },
    addLayer(
      state,
      { payload: { sourceId } }: PayloadAction<{ sourceId: string }>,
    ) {
      const source = state.sources[sourceId];
      const layers = state.sync.layers;
      const list = computeLayerOrder(layers);
      const idx = idxBetween(list.at(-1)?.idx, undefined);
      layers[sourceId] = {
        sourceId,
        idx,
        opacity: source?.defaultOpacity || 1.0,
      };
    },

    setIs3d(state, { payload }: PayloadAction<boolean>) {
      state.sync.is3d = payload;
    },
  },
  extraReducers(builder: ActionReducerMapBuilder<State>) {
    builder.addCase(syncData, (state, { payload }) => {
      const layers = (payload['layers'] ?? {}) as unknown as Layers;
      const is3d = (payload['is3d'] ?? false) as boolean;
      state.sync = { layers, is3d };
    });
  },
});

export default slice.reducer;

export const { updateLayer, removeLayer, addLayer, setIs3d } = slice.actions;

// Selectors

export const selectLayers = (s: RootState) => s.layers.sync.layers;

export const selectLayerDisplayList = createSelector([selectLayers], (layers) =>
  computeLayerOrder(layers),
);

export const selectIs3d = (state: RootState): boolean => state.layers.sync.is3d;

export const selectLayerSources = (state: RootState): LayerSources =>
  state.layers.sources;

export const selectLayerDatas = (state: RootState): LayerDatas =>
  state.layers.datas;

export const selectSprites = createSelector(
  [selectLayerDisplayList, selectLayerSources],
  (layers, sources): [string, string][] => {
    return layers
      .map((l) => sources[l.sourceId])
      .filter((s) => (s === undefined ? false : !!s.sprite))
      .map((s: LayerSource) => [s.id, s.sprite as string]);
  },
);

export const selectLayerSourceDisplayList = createSelector(
  [selectLayerDisplayList, selectLayerSources],
  (layers, sources) => {
    const used = new Set<string>();
    for (const layer of layers) {
      used.add(layer.sourceId);
    }

    const list = Object.values(sources).filter((v) => !used.has(v.id));

    return sortBy(list, (v) => v.name);
  },
);

export const selectLayerSource =
  (sourceId: string) =>
  (state: RootState): LayerSource | undefined =>
    selectLayerSources(state)[sourceId];

export const selectShouldCreditOS = createSelector(
  [selectLayerDisplayList, selectLayerSources, selectLayerDatas],
  (layers, layerSources, dataSources) => {
    return layers
      .map((view) => layerSources[view.sourceId])
      .flatMap((layerSource) => layerSource?.dependencies)
      .filter((dataSourceId) => dataSourceId !== undefined)
      .map((dataSourceId: string) => dataSources[dataSourceId])
      .some((dataSource) => dataSource?.attribution === 'os');
  },
);

const computeLayerOrder = (layers: Layers) =>
  Object.values(layers).sort((a, b) => {
    if (a.idx < b.idx) return -1;
    if (a.idx > b.idx) return 1;
    if (a.sourceId < b.sourceId) return -1;
    if (a.sourceId > b.sourceId) return 1;
    return 0;
  });
