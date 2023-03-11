import {
  SyncYJson,
  SyncYAwareness,
} from '../../../vendor/collaboration-kit/packages/y-redux/src/index';
import { useEffect, useState } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { useAppDispatch, useAppSelector, useAppStore } from '../hooks';
import { Awareness as YAwareness } from 'y-protocols/awareness';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  reportSocketStatus,
  syncData,
  selectEnableLocalSave,
  SocketStatus,
  syncPeerAwares,
} from './slice';
import * as decoding from 'lib0/decoding';
import {
  selectId,
  syncInitialViewAt,
  maybeTimeoutInitialViewAt,
} from '../mapSlice';
import {
  selectSyncData,
  selectSyncLocalAware,
  selectSyncPeerAwares,
} from './syncSelectors';
import { RootState } from '../store/type';

const RESYNC_INTERVAL_MS = 1000 * 60 * 5;
const MAX_BACKOFF_MS = 1000 * 30;
export const APPLY_INITIAL_VIEW_AT_TIMEOUT_MS = 1_000;

const INITIAL_VIEW_AT_TAG = 10;

export default function MapSync() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const id = useAppSelector(selectId);

  const [state, setState] = useState<{
    yAwareness: YAwareness;
    yData: Y.Map<unknown>;
  } | null>(null);

  useEffect(() => {
    const initialViewAtTimeout = setTimeout(() => {
      store.dispatch(maybeTimeoutInitialViewAt());
    }, APPLY_INITIAL_VIEW_AT_TIMEOUT_MS);

    const yDoc = new Y.Doc({ gc: true });
    window._dbg.sync.yDoc = yDoc;
    const yData = yDoc.getMap('data') as Y.Map<unknown>;

    const ws = new WebsocketProvider(wsUrl(), 'sync_socket?' + id, yDoc, {
      resyncInterval: RESYNC_INTERVAL_MS,
      maxBackoffTime: MAX_BACKOFF_MS,
    });
    window._dbg.sync.ws = ws;
    const yAwareness = ws.awareness;
    ws.on('sync', (isSynced: boolean) => {
      console.debug('ws sync', { isSynced });
    });
    ws.on('status', ({ status }: { status: SocketStatus }) => {
      console.debug('ws status', { status });
      dispatch(reportSocketStatus(status));
    });
    ws.on('connection-close', (event: CloseEvent) => {
      console.debug('ws connection-close', event);
    });
    ws.on('connection-error', (event: CloseEvent) => {
      console.debug('ws connection-error', event);
    });
    ws.messageHandlers[INITIAL_VIEW_AT_TAG] = (_enc, dec, _ws, _es, _ty) => {
      const value = JSON.parse(decoding.readVarString(dec));
      console.debug('got initial view at', value);
      dispatch(syncInitialViewAt(value));
    };

    if (selectEnableLocalSave(store.getState())) {
      const idb = new IndexeddbPersistence(`map/${id}`, yDoc);
      window._dbg.sync.idb = idb;
      idb.on('synced', () => {
        console.debug('idb synced');
      });
    }

    setState({ yAwareness, yData });
    return () => {
      clearTimeout(initialViewAtTimeout);
      ws.destroy();
      yDoc.destroy();
    };
  }, [dispatch, id, store]);

  if (!state) return <></>;
  return (
    <>
      <SyncYJson
        yJson={state.yData}
        selectData={(state: RootState) => selectSyncData(state)}
        setData={syncData}
      />
      <SyncYAwareness
        awareness={state.yAwareness}
        selectLocalAwarenessState={(state: RootState) =>
          selectSyncLocalAware(state)
        }
        selectPeerAwarenessStates={(state: RootState) =>
          selectSyncPeerAwares(state)
        }
        setPeerAwarenessStates={syncPeerAwares}
      />
    </>
  );
}

const wsUrl = () => {
  const server = new URL(location.href);
  server.protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  server.pathname = '';
  server.search = '';
  return server.toString();
};
