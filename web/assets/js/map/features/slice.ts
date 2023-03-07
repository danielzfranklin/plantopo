import {
  createAction,
  createSelector,
  createSlice,
  PayloadAction,
} from '@reduxjs/toolkit';
import { castDraft } from 'immer';
import { RootState } from '../store/store';
import { selectPeers } from '../sync/slice';
import {
  computeAtAfter,
  computeFeaturesDisplayList,
  computeFeaturesList,
  deleteFeatures,
  parentIdOf,
} from './algorithms';
import {
  Feature,
  Features,
  GroupFeature,
  PointFeature,
  ROOT_FEATURE,
  RouteFeature,
} from './types';
import { v4 as uuid } from 'uuid';
import { startListening } from '../store/listener';
import isObject from '../util/isObject';
import sortBy from '../util/sortBy';

export interface State {
  creating?: {
    type: string;
    at: string;
  };
  active?: string;
  sync: {
    features: Features;
    featureTrash: Features;
  };
}

const initialState: State = {
  creating: undefined,
  active: undefined,
  sync: {
    features: {},
    featureTrash: {},
  },
};

export type ActiveFeature =
  | GroupFeature
  | PointFeature
  | RouteFeature
  | undefined;

const slice = createSlice({
  name: 'features',
  initialState,
  reducers: {
    sync: (state, action: PayloadAction<State['sync']>) => {
      state.sync = action.payload;
    },

    setActive(state, { payload }: PayloadAction<string | undefined>) {
      state.active = payload;
    },

    enterLatlngPicker(state, { payload }: PayloadAction<{ type: string }>) {
      const features = state.sync.features;
      const beforeId = state.active;
      const at = computeAtAfter(features, beforeId);
      state.creating = {
        type: payload.type,
        at,
      };
    },
    createGroup(state, { payload }: PayloadAction<{ id: string }>) {
      const features = state.sync.features;
      const beforeId = state.active;
      const at = computeAtAfter(features, beforeId);
      const { id } = payload;
      features[id] = castDraft({
        type: 'group',
        id,
        at,
      });
      state.active = id;
    },
    createPoint(
      state,
      { payload }: PayloadAction<Pick<PointFeature, 'id' | 'at' | 'lngLat'>>,
    ) {
      state.sync.features[payload.id] = {
        id: payload.id,
        type: 'point',
        at: payload.at,
        lngLat: payload.lngLat,
        style: {},
      };
      state.active = payload.id;
      state.creating = undefined;
    },
    cancelCreating(state, _action: PayloadAction<undefined>) {
      state.creating = undefined;
    },

    updateFeature(
      state,
      { payload }: PayloadAction<{ id: string; update: Partial<Feature> }>,
    ) {
      // Note that the prop of a prop is never an object
      const feature = state.sync.features[payload.id];
      if (!feature) throw new Error('updateFeature: not found');
      for (const prop in payload.update) {
        const updateVal = payload.update[prop];

        if (isObject(updateVal)) {
          feature[prop] = { ...feature[prop], ...updateVal };
        } else {
          feature[prop] = { ...feature[prop], ...updateVal };
        }
      }
    },
    deleteFeature(state, { payload }: PayloadAction<Feature>) {
      const data = state.sync;

      const { id } = payload;
      const parentId = parentIdOf(payload);

      const sibList = computeFeaturesDisplayList(parentId, data.features);
      const deletedDisplayIdx = sibList.findIndex((f) => f.id === id);
      if (deletedDisplayIdx > -1) {
        const nextActive =
          sibList.at(deletedDisplayIdx + 1) ||
          sibList.at(deletedDisplayIdx - 1);
        state.active = nextActive?.id;
      }

      const { features, trash } = deleteFeatures(
        data.features,
        data.featureTrash,
        payload,
      );
      data.features = features;
      data.featureTrash = trash;
    },
  },
});

export default slice.reducer;
const actions = slice.actions;

export const {
  sync,
  setActive,
  enterLatlngPicker,
  cancelCreating,
  deleteFeature,
} = actions;

export const moveActive = createAction<'down' | 'up' | 'in' | 'out'>(
  'features/moveActive',
);
export const createGroup = createAction('features/createGroup', () => ({
  payload: { id: uuid() },
}));
export const createPoint = createAction(
  'features/createPoint',
  ({ at, lngLat }: Pick<PointFeature, 'at' | 'lngLat'>) => ({
    payload: { id: uuid(), at, lngLat },
  }),
);
export const updateFeature = createAction(
  'features/updateFeature',
  (id: string, update: Partial<Feature>) => ({
    payload: { id, update },
  }),
);

startListening({
  actionCreator: moveActive,
  effect: ({ payload }, l) => {
    const state = l.getState();
    const features = state.features.sync.features;
    const prevId = state.features.active;
    const prev = prevId ? features[prevId] : null;

    let nextActive;
    if (!prev) {
      const list = computeFeaturesDisplayList(ROOT_FEATURE, features);
      const next = list.at(0);
      if (next) nextActive = next.id;
    } else if (payload === 'in') {
      if (prev.type !== 'group') return;
      const list = computeFeaturesDisplayList(prev.id, features);
      const next = list.at(0);
      if (next) nextActive = next.id;
    } else if (payload === 'out') {
      const parentId = parentIdOf(prev);
      if (parentId !== ROOT_FEATURE) {
        nextActive = parentId;
      }
    } else {
      const list = computeFeaturesDisplayList(parentIdOf(prev), features);
      const prevIdx = list.findIndex((f) => f.id === prevId);
      let nextIdx = payload === 'up' ? prevIdx - 1 : prevIdx + 1;
      if (nextIdx > list.length - 1) nextIdx = 0;
      const next = list.at(nextIdx);
      if (next) nextActive = next.id;
    }

    if (nextActive) {
      l.dispatch(setActive(nextActive));
    }
  },
});

export const selectCreating = (state: RootState) => state.features.creating;

export const selectFeatures = (state: RootState) =>
  state.features.sync.features;

export const selectActiveFeature = (state: RootState): ActiveFeature => {
  const map = selectFeatures(state);
  const id = state.features.active;
  if (!id) return;
  const feature = map[id];
  if (!feature) return;

  if (!['group', 'route', 'point'].includes(feature.type)) {
    console.warn('Unexpected active feature', feature);
    return;
  }

  return feature as any;
};

export const selectIsActiveFeature = (id: string) => (state: RootState) =>
  id && state.features.active === id;

export const selectPeersActiveOnFeature = (id: string) =>
  createSelector([selectPeers], (peers) =>
    Object.values(peers).filter((peer) => peer.activeFeature === id),
  );

export const selectFeaturesList = (parentId: string) =>
  createSelector([selectFeatures], (features) =>
    computeFeaturesList(parentId, features),
  );

export const selectFeaturesDisplayList = (parentId: string) =>
  createSelector([selectFeatures], (features) =>
    computeFeaturesDisplayList(parentId, features),
  );

export const selectFirstTopLevelFeature = createSelector(
  [selectFeaturesDisplayList(ROOT_FEATURE)],
  (list) => list.at(0),
);

export const selectLastTopLevelFeature = createSelector(
  [selectFeaturesDisplayList(ROOT_FEATURE)],
  (list) => list.at(-1),
);

const COMMON_COUNT = 14;
// prettier-ignore
const DEFAULT_COMMON = [
  'feature:maki-circle', 'feature:maki-circle-stroked', 'feature:maki-triangle',
  'feature:maki-triangle-stroked', 'feature:maki-square', 'feature:maki-square-stroked',
  'feature:maki-star', 'feature:maki-star-stroked', 'feature:maki-heart', 'feature:maki-embassy',
  'feature:maki-marker', 'feature:maki-marker-stroked', 'feature:maki-campsite',
  'feature:maki-parking', 'feature:maki-water',
];

export const selectCommonSprites = createSelector(
  [selectFeatures],
  (features) => {
    const counts = new Map<string, number>();
    for (const feature of Object.values(features)) {
      if (feature.type === 'point') {
        const sprite = feature.style?.['icon-image'];
        if (sprite) {
          counts.set(sprite, (counts.get(sprite) || 0) + 1);
        }
      } else if (feature.type === 'group') {
        const pointSprite = feature.childPointStyle?.['icon-image'];
        if (pointSprite) {
          counts.set(pointSprite, (counts.get(pointSprite) || 0) + 1);
        }

        const routeSprite = feature.childRouteLabelStyle?.['icon-image'];
        if (routeSprite) {
          counts.set(routeSprite, (counts.get(routeSprite) || 0) + 1);
        }
      } else if (feature.type === 'route') {
        const sprite = feature.labelStyle?.['icon-image'];
        if (sprite) counts.set(sprite, (counts.get(sprite) || 0) + 1);
      }
    }

    const out = sortBy(counts.entries(), ([_sprite, count]) => count)
      .slice(0, COMMON_COUNT - 1)
      .map(([sprite, _count]) => sprite);

    for (const sprite of DEFAULT_COMMON) {
      if (out.length === COMMON_COUNT) break;
      if (!out.includes(sprite)) {
        out.push(sprite);
      }
    }

    return out;
  },
);
