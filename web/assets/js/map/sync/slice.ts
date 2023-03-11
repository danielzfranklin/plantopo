import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../store/type';
import { PeerAwareData, SyncData } from './types';
import { CurrentUser } from '../../globals';

export interface State {
  user: CurrentUser | null;
  onlineStatus: 'connecting' | 'connected' | 'reconnecting';
  enableLocalSave: boolean;
  peerAwares: Record<number, PeerAwareData>;
}

const searchParams = new URLSearchParams(location.search);
const disableLocalSave = searchParams.has('noLocal') ?? false;

const initialState: State = {
  user: window.currentUser,
  onlineStatus: 'connecting',
  enableLocalSave: !disableLocalSave,
  peerAwares: {},
};

export type SocketStatus = 'disconnected' | 'connecting' | 'connected';

const slice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    reportSocketStatus(state, { payload }: PayloadAction<SocketStatus>) {
      if (
        state.onlineStatus === 'connecting' ||
        state.onlineStatus === 'reconnecting'
      ) {
        if (payload === 'connected') {
          state.onlineStatus = 'connected';
        }
      } else if (state.onlineStatus === 'connected') {
        if (payload === 'disconnected' || payload === 'connecting') {
          state.onlineStatus = 'reconnecting';
        }
      }
    },
    syncData(_state, _action: PayloadAction<SyncData>) {},
    syncPeerAwares(
      state,
      { payload }: PayloadAction<Record<number, PeerAwareData>>,
    ) {
      state.peerAwares = payload;
    },
  },
});

export const { syncData, reportSocketStatus, syncPeerAwares } = slice.actions;

export default slice.reducer;

// Selectors

export const selectPeers = (state: RootState) => state.sync.peerAwares;

export const selectEnableLocalSave = (state: RootState) =>
  state.sync.enableLocalSave;
