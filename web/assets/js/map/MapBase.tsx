import { useRef, useEffect } from 'react';
import * as ml from 'maplibre-gl';
import deepEqual from 'react-fast-compare';
import { useAppDispatch, useAppStore } from './hooks';
import {
  flyTo,
  reportViewAt,
  selectGeolocation,
  selectTokens,
  selectViewAt,
  selectLayerDatas,
  selectLayers,
  selectLayerSources,
  ViewAt,
  selectIs3d,
  selectInCreate,
  mapClick,
} from './mapSlice';
import '../globals';
import { startListening, stopListening } from './listener';
import '../map';
import computeStyle from './computeStyle';
import reportLayerDataRequest from './reportLayerDataRequest';

export interface Props {
  isLoading: (_: boolean) => void;
}

const FEATURE_POINTER_TARGET_PX = 20;
const FLY_TO_SPEED = 2.8;

export default function MapBase(props: Props) {
  const store = useAppStore();
  const dispatch = useAppDispatch();

  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const state = store.getState();
    const tokens = selectTokens(state);
    const viewAt = selectViewAt(state);

    const map = new ml.Map({
      container: nodeRef.current!,
      style: {
        version: 8,
        sources: {},
        layers: [],
      },
      center: viewAt?.center,
      pitch: viewAt?.pitch,
      bearing: viewAt?.bearing,
      zoom: viewAt?.zoom,
      keyboard: false,
      transformRequest: (urlS) => {
        const url = new URL(urlS);
        const params = url.searchParams;

        if (url.host === 'api.os.uk') {
          params.set('srs', '3857');
          params.set('key', tokens.os);
        } else if (url.host === 'api.mapbox.com') {
          params.set('access_token', tokens.mapbox);
        }

        return {
          url: url.toString(),
        };
      },
    });
    window._dbg.mapGL = map;

    map.on('data', (e) => {
      const sourceId = e['sourceId'];
      const tileId = e['tile']?.tileID?.canonical;
      if (e.dataType === 'source' && sourceId && tileId) {
        reportLayerDataRequest(sourceId, tileId.x, tileId.y, tileId.z);
      }
    });

    const flyToListener = {
      actionCreator: flyTo,
      effect: async ({ payload }, _l) => {
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

        const opts: ml.FlyToOptions = {
          center,
          zoom,
          pitch,
          bearing,
          speed: FLY_TO_SPEED,
        };

        if (window.appSettings.disableAnimation) {
          opts.duration = 0;
        }

        map.flyTo(opts);
      },
    };
    startListening(flyToListener);

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
      const point = evt.point;
      const features = map
        .queryRenderedFeatures([
          [
            point.x - FEATURE_POINTER_TARGET_PX / 2,
            point.y - FEATURE_POINTER_TARGET_PX / 2,
          ],
          [
            point.x + FEATURE_POINTER_TARGET_PX / 2,
            point.y + FEATURE_POINTER_TARGET_PX / 2,
          ],
        ])
        .map((f) => ({
          layer: f.layer.id,
          properties: f.properties,
        }));

      dispatch(
        mapClick({
          lngLat: [evt.lngLat.lng, evt.lngLat.lat],
          screen: [evt.point.x, evt.point.y],
          features,
        }),
      );
    });

    for (const evt of ['dataloading', 'dataabort', 'data']) {
      map.on(evt, () => {
        map && props.isLoading(!map.areTilesLoaded());
      });
    }

    const geoLocMarker = new ml.Marker({ element: createGeolocMarkerElem() });

    let prevState;
    const storeUnsubscribe = store.subscribe(() => {
      const state = store.getState();

      const is3d = selectIs3d(state);
      const layers = selectLayers(state);
      const prevLayers = prevState && selectLayers(prevState);
      const prevIs3d = prevState && selectIs3d(prevState);
      computeStyle(
        selectLayerDatas(state),
        selectLayerSources(state),
        is3d,
        layers,
        prevIs3d,
        prevLayers,
        (style, change3d) =>
          requestAnimationFrame(() => {
            map.setStyle(style);
            map.once('styledata', () => {
              if (change3d === false) {
                // Work around a type def bug
                map.setTerrain(undefined as unknown as ml.TerrainSpecification);
              } else if (typeof change3d === 'string') {
                map.setTerrain({ source: change3d });
              }
            });
          }),
        (id, prop, value) =>
          map.setPaintProperty(id, prop, value, { validate: false }),
      );

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
      if (selectInCreate(state)) {
        canvas.classList.add('cursor-crosshair');
      } else {
        canvas.classList.remove('cursor-crosshair');
      }

      prevState = state;
    });

    return () => {
      stopListening(flyToListener);
      storeUnsubscribe?.();
      map.remove();
    };
  }, []);

  return <div ref={nodeRef} className="map-base" />;
}

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
