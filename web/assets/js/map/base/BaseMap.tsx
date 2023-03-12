import { useRef, useEffect } from 'react';
import * as mlStyle from '@maplibre/maplibre-gl-style-spec';
import * as ml from 'maplibre-gl';
import deepEqual from 'react-fast-compare';
import { useAppDispatch, useAppStore } from '../hooks';
import {
  flyTo,
  reportViewAt,
  selectInitialViewAt,
  selectTokens,
  selectViewAt,
} from '../mapSlice';
import {
  selectLayerDatas,
  selectLayerDisplayList,
  selectLayerSources,
  selectIs3d,
  selectSprites,
} from '../layers/slice';
import { ViewAt } from '../ViewAt';
import '../../globals';
import { startListening, stopListening } from '../store/listener';
import '../../map';
import { computeLayers, computeSources, computeTerrain } from './computeStyle';
import reportTileLoad from './reportTileLoad';
import computeFeaturesGeoJson from './featuresGeoJson';
import { DeltaType, diff, OperationType } from '@sanalabs/json';
import { RootState } from '../store/type';
import { USER_FEATURES_DATA_ID } from './featuresLayer';
import '../../../node_modules/maplibre-gl/dist/maplibre-gl.css';
import { computeFeatureBbox, serializeLngLat } from '../features/algorithms';
import { selectGeolocation } from '../controls/slice';
import * as featuresSlice from '../features/slice';
import { selectFeatures } from '../features/slice';
import { selectSidebarOpen } from '../sidebar/slice';

export interface Props {
  isLoading: (_: boolean) => void;
  setAttribution: (_: string[]) => void;
}

const FLY_TO_SPEED = 2.8;
const FLY_TO_PADDING_PX = 100;

export default function BaseMap(props: Props) {
  const store = useAppStore();
  const dispatch = useAppDispatch();
  const { isLoading, setAttribution } = props;

  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const state = store.getState();
    const tokens = selectTokens(state);
    const initialViewAt = selectViewAt(state);
    const layerDatas = selectLayerDatas(state);

    const spriteUrl = new URL(location.href);
    spriteUrl.search = '';
    spriteUrl.hash = '';
    spriteUrl.pathname = '/sprite/sprite';

    const map = new ml.Map({
      container: nodeRef.current!,
      style: {
        version: 8,
        sources: computeSources(layerDatas),
        layers: [],
        glyphs: 'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf',
        sprite: [{ id: 'feature', url: spriteUrl.toString() }],
      },
      center: initialViewAt?.center ?? [0, 0],
      pitch: initialViewAt?.pitch ?? 0,
      bearing: initialViewAt?.bearing ?? 0,
      zoom: initialViewAt?.zoom ?? 0,
      keyboard: false,
      attributionControl: false,
      transformRequest: (urlS) => {
        const url = new URL(urlS);
        const params = url.searchParams;

        if (url.host === 'api.os.uk') {
          params.set('srs', '3857');
          params.set('key', tokens.os);
        } else if (url.host === 'api.mapbox.com') {
          params.set('access_token', tokens.mapbox);
        } else if (url.host === 'api.maptiler.com') {
          params.set('key', tokens.maptiler);
        }

        return {
          url: url.toString(),
        };
      },
    });
    window._dbg.mapGL = map;

    const geoLocMarker = new ml.Marker({ element: createGeolocMarkerElem() });

    let storeUnsubscribe;
    let setInitialViewAt = false;
    map.on('load', () => {
      let prevState: RootState | undefined;
      let prevLayers: mlStyle.LayerSpecification[] | undefined;
      const addedSprites = new Set();
      const matchStates = () => {
        const state = store.getState();

        const initialViewAt = selectInitialViewAt(state);
        if (initialViewAt && !setInitialViewAt) {
          setInitialViewAt = true;
          map.jumpTo(initialViewAt);
        }

        const featureMap = selectFeatures(state);
        if (!prevState || featureMap !== selectFeatures(prevState)) {
          const json = computeFeaturesGeoJson(featureMap);
          const source = map.getSource(
            USER_FEATURES_DATA_ID,
          ) as ml.GeoJSONSource;
          source.setData(json);
        }

        const is3d = selectIs3d(state);
        if (!prevState || is3d !== selectIs3d(prevState)) {
          if (is3d) {
            const terrain = computeTerrain();
            map.setTerrain(terrain);
          } else {
            // Workaround type def bug
            (map.setTerrain as any)();
          }
        }

        const sprites = selectSprites(state);
        if (!prevState || sprites !== selectSprites(prevState)) {
          for (const [id, sprite] of sprites) {
            // We don't remove no longer needed sprites because they're pretty
            // small and there's a decent change we'll need them again
            if (!addedSprites.has(id)) {
              map.addSprite(id, sprite);
              addedSprites.add(id);
            }
          }
        }

        const layers = computeLayers(
          selectLayerSources(state),
          selectLayerDisplayList(state),
        );
        if (!prevLayers) {
          for (const layer of layers) {
            map.addLayer(layer);
          }
        } else {
          const layersDelta = diff(prevLayers, layers);
          if (layersDelta.type !== DeltaType.Array)
            throw new Error('Unreachable');
          for (const layerOp of layersDelta.operations) {
            if (layerOp.operationType === OperationType.Deletion) {
              for (const l of prevLayers.slice(layerOp.index, layerOp.count)) {
                map.removeLayer(l.id);
              }
            } else if (layerOp.operationType === OperationType.Insertion) {
              for (const l of layerOp.values as mlStyle.LayerSpecification[]) {
                moveLayer(map, prevLayers, layerOp.index, l);
              }
            } else if (layerOp.operationType === OperationType.Substitution) {
              const l = layerOp.value as mlStyle.LayerSpecification;
              moveLayer(map, prevLayers, layerOp.index, l);
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            } else if (layerOp.operationType === OperationType.Nested) {
              const layer = layers[layerOp.index]!;
              const layerDelta = layerOp.delta;
              if (layerDelta.type !== DeltaType.Object)
                throw new Error('Unreachable');

              const onlyChildOp =
                layerDelta.operations.length === 1
                  ? layerDelta.operations[0]
                  : null;
              if (
                onlyChildOp &&
                onlyChildOp.key === 'paint' &&
                onlyChildOp.operationType === OperationType.Nested
              ) {
                const paintDelta = onlyChildOp.delta;
                if (paintDelta.type !== DeltaType.Object)
                  throw new Error('Unreachable');

                for (const op of paintDelta.operations) {
                  let value;
                  if (op.operationType === OperationType.Deletion) {
                    value = undefined;
                  } else if (
                    op.operationType === OperationType.Insertion ||
                    op.operationType === OperationType.Substitution
                  ) {
                    value = op.value;
                  } else {
                    throw new Error('Unreachable');
                  }
                  map.setPaintProperty(layer.id, op.key, value, {
                    validate: false,
                  });
                }
              } else {
                moveLayer(map, prevLayers, layerOp.index, layer);
              }
            } else {
              throw new Error('Unreachable');
            }
          }
        }
        prevLayers = layers;

        const geoLoc = selectGeolocation(state);
        if (!prevState || geoLoc !== selectGeolocation(prevState)) {
          if (geoLoc.value) {
            geoLocMarker.setLngLat(geoLoc.value.position);
            geoLocMarker.addTo(map);
          } else {
            geoLocMarker.remove();
          }
        }

        const canvas = map.getCanvas();
        if (featuresSlice.selectCreating(state)) {
          canvas.classList.add('cursor-crosshair');
        } else {
          canvas.classList.remove('cursor-crosshair');
        }

        prevState = state;
      };
      storeUnsubscribe = store.subscribe(matchStates);
      matchStates();
    });

    map.on('data', (e) => {
      const sourceId = e['sourceId'];
      const tileId = e['tile']?.tileID?.canonical;
      if (
        e.dataType === 'source' &&
        sourceId &&
        tileId &&
        sourceId !== USER_FEATURES_DATA_ID
      ) {
        reportTileLoad(sourceId, tileId.x, tileId.y, tileId.z);
      }
    });

    const flyToListener = {
      actionCreator: flyTo,
      effect: async ({ payload }, l) => {
        const current = selectViewAt(store.getState());
        if (!current) return;
        const { options, to } = payload;

        const center = to.center || current.center;
        const zoom = to.zoom || current.zoom;
        const pitch = to.pitch || current.pitch;
        const bearing = to.bearing || current.bearing;

        if (options.ignoreIfCenterVisible && map.getBounds().contains(center)) {
          return;
        }

        map.flyTo({
          ...flyToOpts(l.getState()),
          center,
          zoom,
          pitch,
          bearing,
        });
      },
    };
    startListening(flyToListener);

    const fitActiveListener = {
      actionCreator: featuresSlice.setActive,
      effect: async ({ payload }, l) => {
        if (!payload) return;
        const features = selectFeatures(l.getState());
        const feature = features[payload];
        if (!feature) return;

        requestAnimationFrame(() => {
          const bbox = computeFeatureBbox(feature, features);
          if (!bbox) return;

          const bounds = new ml.LngLatBounds(bbox);
          const mapBounds = map.getBounds();
          const alreadyInView =
            mapBounds.contains(bounds.getSouthWest()) &&
            mapBounds.contains(bounds.getNorthEast());

          if (!alreadyInView) {
            map.fitBounds(bounds, flyToOpts(l.getState()));
          }
        });
      },
    };
    startListening(fitActiveListener);

    // Note that move is fired during any transition
    map.on('move', () => {
      const state = store.getState();

      const center = map.getCenter();
      const at: ViewAt = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
      const prevAt = selectViewAt(state);
      if (!deepEqual(at, prevAt)) {
        dispatch(reportViewAt(at));
      }
    });

    map.on('click', (evt) => {
      // const FEATURE_POINTER_TARGET_PX = 20;
      // const features = map
      //   .queryRenderedFeatures([
      //     [
      //       point.x - FEATURE_POINTER_TARGET_PX / 2,
      //       point.y - FEATURE_POINTER_TARGET_PX / 2,
      //     ],
      //     [
      //       point.x + FEATURE_POINTER_TARGET_PX / 2,
      //       point.y + FEATURE_POINTER_TARGET_PX / 2,
      //     ],
      //   ]);

      const state = store.getState();
      const featureCreating = featuresSlice.selectCreating(state);
      if (featureCreating) {
        const { type, at } = featureCreating;

        if (type === 'point') {
          const lngLat = serializeLngLat([evt.lngLat.lng, evt.lngLat.lat]);
          dispatch(featuresSlice.createPoint({ at, lngLat }));
        }
      }
    });

    for (const evt of ['dataloading', 'dataabort', 'data']) {
      map.on(evt, () => {
        isLoading(!map.areTilesLoaded());
      });
    }

    for (const evt of ['styledata', 'sourcedata', 'terrain']) {
      map.on(evt, (e) => {
        if (
          e?.['sourceDataType'] === 'metadata' ||
          e?.['sourceDataType'] === 'visibility' ||
          e?.['dataType'] === 'style' ||
          e?.['type'] === 'terrain'
        ) {
          const list = new Set<string>();
          for (const cache of Object.values(map.style.sourceCaches)) {
            if (cache.used || cache.usedForTerrain) {
              const attrib = cache.getSource().attribution;
              if (attrib) list.add(attrib);
            }
          }
          const value = Array.from(list.values()).sort();
          setAttribution(value);
        }
      });
    }

    return () => {
      stopListening(flyToListener);
      stopListening(fitActiveListener);
      storeUnsubscribe?.();
      map.remove();
    };
  }, [dispatch, isLoading, store, setAttribution]);

  return <div ref={nodeRef} className="map-base" />;
}

const moveLayer = (
  map: ml.Map,
  prevLayers: mlStyle.LayerSpecification[],
  idx: number,
  value: mlStyle.LayerSpecification,
) => {
  let after = prevLayers.at(idx + 1);
  if (after && after.id === value.id) {
    after = prevLayers.at(idx + 2);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (map.getLayer(value.id)) {
    map.removeLayer(value.id);
  }

  map.addLayer(value, after?.id);
};

const createGeolocMarkerElem = () => {
  const elem = document.createElement('div');
  const parent = document.createElement('div');
  const center = document.createElement('div');
  const outer = document.createElement('div');
  elem.append(parent);
  parent.append(outer);
  parent.append(center);
  parent.className = 'flex items-center justify-center';
  center.className =
    'm-auto absolute w-[18px] h-[18px] bg-sky-600 rounded-full border border-[2px] border-white';
  outer.className =
    'm-auto absolute w-[54px] h-[54px] bg-sky-400 opacity-40 rounded-full';
  return elem;
};

const flyToOpts = (state: RootState): ml.FlyToOptions => {
  const opts: ml.FlyToOptions = {
    speed: FLY_TO_SPEED,
    padding: FLY_TO_PADDING_PX,
  };

  if (window.appSettings.disableAnimation) {
    opts.duration = 0;
  }

  if (selectSidebarOpen(state)) {
    const sidebarElem = document.querySelector('.sidebar');
    if (sidebarElem) {
      opts.padding = {
        top: FLY_TO_PADDING_PX,
        right: FLY_TO_PADDING_PX,
        bottom: FLY_TO_PADDING_PX * 4, // bugfix: for some reason it's under-computed
        left: sidebarElem.getBoundingClientRect().width + FLY_TO_PADDING_PX,
      };
    } else {
      console.error('selectSidebarOpen but no elem');
    }
  }

  return opts;
};
