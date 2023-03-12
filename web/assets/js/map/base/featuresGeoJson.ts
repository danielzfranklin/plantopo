import { deserializeLngLat, parentIdOf } from '../features/algorithms';
import { DEFAULT_POINT_STYLE } from '../features/defaultStyle';
import {
  Features,
  PointStyle,
  ROOT_FEATURE,
  RouteLineStyle,
} from '../features/types';

const JSON_STYLE_PROPS = ['icon-offset', 'text-offset'];

export default function computeFeaturesGeoJson(
  features: Features,
): GeoJSON.FeatureCollection {
  const json: GeoJSON.Feature<GeoJSON.Point>[] = [];

  const inheritedStyle = new Map<string, Inherited>();

  for (const feat of Object.values(features)) {
    if (feat.type !== 'group') continue;

    const value: Inherited = {
      point: { ...DEFAULT_POINT_STYLE },
      routeLabel: {},
      routeLine: {},
    };
    let nextParentId = parentIdOf(feat);
    while (nextParentId !== ROOT_FEATURE) {
      const parent = features[nextParentId];
      if (!parent) break;
      if (parent.type !== 'group') throw new Error('unreachable');

      const iVal = inheritedStyle.get(nextParentId);
      if (iVal) {
        value.point = { ...value.point, ...iVal.point };
        value.routeLabel = { ...value.routeLabel, ...iVal.routeLabel };
        value.routeLine = { ...value.routeLine, ...iVal.routeLine };
        break;
      }

      value.point = { ...value.point, ...parent.childPointStyle };
      value.routeLabel = { ...value.routeLabel, ...parent.childRouteLabelStyle }; // prettier-ignore
      value.routeLine = { ...value.routeLine, ...parent.childRouteLineStyle };

      nextParentId = parentIdOf(parent);
    }
    inheritedStyle.set(feat.id, value);
  }

  for (const feat of Object.values(features)) {
    if (feat.type === 'point') {
      const properties = {
        visible: feat.visible || true,
        name: feat.name,
      };

      const inherit = inheritedStyle.get(parentIdOf(feat));
      for (const source of [inherit?.point, feat.style]) {
        if (!source) continue;
        for (const [k, v] of Object.entries(source)) {
          let value = v;
          if (JSON_STYLE_PROPS.includes(k)) {
            value = JSON.parse(v);
          }
          properties['style:' + k] = value;
        }
      }

      json.push({
        id: feat.id,
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: deserializeLngLat(feat.lngLat),
        },
        properties,
      });
    } else if (feat.type === 'group') {
      // Ignore
    } else {
      console.info(`featuresGeoJson: unsupported type: ${feat.type}`, feat);
    }
  }

  return {
    type: 'FeatureCollection',
    features: json,
  };
}

interface Inherited {
  point: PointStyle;
  routeLabel: PointStyle;
  routeLine: RouteLineStyle;
}
