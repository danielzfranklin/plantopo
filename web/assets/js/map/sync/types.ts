import { JsonObject, JsonTemplateObject } from '@sanalabs/json';
import { BaseAwarenessState } from '../../../vendor/collaboration-kit/packages/y-redux/src/index';
import { Features } from '../features/types';
import { Layers } from '../layers/types';
import { ViewAt } from '../ViewAt';

export interface PeerAwareData extends AwareData, BaseAwarenessState {
  clientId: number;
}

export interface AwareData extends JsonObject {
  user?: { username: string; id: string };
  viewAt?: ViewAt;
  activeFeature?: string;
  [other: string]: any;
}

export interface SyncData extends JsonTemplateObject {
  layers?: Layers;
  is3d?: boolean;
  features?: Features;
  featureTrash?: Features;
  [other: string]: any;
}
