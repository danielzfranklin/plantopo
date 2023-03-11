import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store/type';
import { AwareData, PeerAwareData, SyncData } from './types';
import { selectIs3d, selectLayers } from '../layers/slice';
import {
  selectActiveFeature,
  selectFeatures,
  selectFeatureTrash,
} from '../features/slice';
import { selectInitialViewAt, selectViewAt } from '../mapSlice';

// NOTE: This is a separate file to work around a recursive import bug
// in esbuild. Without this some of the selectors were importing as undefined.

export const selectSyncData: (state: RootState) => SyncData = createSelector(
  [selectLayers, selectIs3d, selectFeatures, selectFeatureTrash],
  (layers, is3d, features, featureTrash) => ({
    layers,
    is3d,
    features,
    featureTrash,
  }),
);

export const selectSyncLocalAware: (state: RootState) => AwareData =
  createSelector(
    [
      (s) => s.sync.user,
      selectActiveFeature,
      selectViewAt,
      selectInitialViewAt,
    ],
    (user, activeFeature, viewAt) => ({
      user: user ?? undefined,
      viewAt,
      activeFeature: activeFeature?.id,
    }),
  );

export const selectSyncPeerAwares = (
  state: RootState,
): Record<number, PeerAwareData> => state.sync.peerAwares;
