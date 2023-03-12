import {
  createAction,
  createSlice,
  isAnyOf,
  PayloadAction,
} from '@reduxjs/toolkit';
import { flash } from '../flash/slice';
import { LngLat } from '../LngLat';
import { flyTo, selectViewAt } from '../mapSlice';
import { startListening } from '../store/listener';
import { RootState } from '../store/type';
import { GeolocState } from './GeolocState';

export interface State {
  geolocation: GeolocState;
}

const initialState: State = {
  geolocation: {
    updating: false,
  },
};

const slice = createSlice({
  name: 'controls',
  initialState,
  reducers: {
    setGeolocation(state, { payload }: PayloadAction<GeolocState>) {
      state.geolocation = payload;
    },
    clearGeolocation(state, _action: PayloadAction<undefined>) {
      state.geolocation = { updating: false };
    },
  },
});

export default slice.reducer;
const { actions } = slice;
export const { clearGeolocation } = actions;

export const requestGeolocation = createAction('controls/requestGeolocation');
export const zoomIn = createAction('controls/zoomIn');
export const zoomOut = createAction('controls/zoomOut');
export const requestFullscreen = createAction('controls/requestFullscreen'); // Requires transient user activation
export const exitFullscreen = createAction('controls/exitFullscreen');

export const selectGeolocation = (state: RootState) =>
  state.controls.geolocation;

startListening({
  actionCreator: zoomIn,
  effect: (_action, l) => {
    const current = selectViewAt(l.getState());
    if (!current) return;
    l.dispatch(flyTo({ zoom: Math.round(current.zoom + 1) }));
  },
});

startListening({
  actionCreator: zoomOut,
  effect: (_action, l) => {
    const current = selectViewAt(l.getState());
    if (!current) return;
    l.dispatch(flyTo({ zoom: Math.round(current.zoom - 1) }));
  },
});

startListening({
  actionCreator: requestFullscreen,
  effect: async (_action, l) => {
    if (document.fullscreenElement) {
      console.info('Suppressing requestFullscreen as already fullscreen');
      return;
    }

    if (!document.fullscreenEnabled) {
      l.dispatch(
        flash({
          kind: 'error',
          title: 'Fullscreen disabled',
          body: 'Your browser indicated fullscreen is disabled',
        }),
      );
    }

    try {
      await window.appNode.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) {
      if (e instanceof TypeError) {
        l.dispatch(
          flash({
            kind: 'error',
            title: 'Error',
            body: 'Your browser refused to enter fullscreen mode',
          }),
        );
      } else {
        throw e;
      }
    }
  },
});

startListening({
  actionCreator: exitFullscreen,
  effect: async (_action, _l) => {
    if (!document.fullscreenElement) {
      console.info('Suppressing exitFullscreen as not fullscreen');
      return;
    }
    await document.exitFullscreen();
  },
});

startListening({
  matcher: isAnyOf(requestGeolocation, clearGeolocation),
  effect: async (action, l) => {
    if (action.type === clearGeolocation.type) {
      l.cancelActiveListeners();
      return;
    }

    const prev = selectGeolocation(l.getState());
    l.dispatch(
      actions.setGeolocation({
        updating: true,
        value: prev.value,
      }),
    );

    // Remember cancelling this listener cancels the fork, but the underlying
    // request still runs to completion.
    const result = await l.fork<GeolocationPosition>(
      (_f) =>
        new Promise((res, rej) => {
          navigator.geolocation.getCurrentPosition(res, rej, {
            maximumAge: 1000 * 60 * 60 * 24 * 7,
            timeout: 1000 * 10,
            enableHighAccuracy: true,
          });
        }),
    ).result;

    if (result.status === 'ok') {
      const { accuracy, latitude, longitude } = result.value.coords;
      const position: LngLat = [longitude, latitude];

      l.dispatch(
        actions.setGeolocation({
          updating: false,
          value: { accuracy, position },
        }),
      );

      l.dispatch(flyTo({ center: position }, { ignoreIfCenterVisible: true }));
    } else if (result.status === 'cancelled') {
      // We received clearGeolocation
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (result.status === 'rejected') {
      const err = result.error;
      if (!(err instanceof GeolocationPositionError)) {
        throw err;
      }

      l.dispatch(actions.setGeolocation({ updating: false, value: undefined }));

      if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
        l.dispatch(
          flash({
            kind: 'error',
            title: 'Location permission denied',
          }),
        );
      } else if (
        err.code === GeolocationPositionError.POSITION_UNAVAILABLE ||
        err.code === GeolocationPositionError.TIMEOUT
      ) {
        l.dispatch(
          flash({
            kind: 'error',
            title: 'Location unavailable',
          }),
        );
      } else {
        throw new Error(
          `Unexpected GeolocationPositionError code: ${err.code} msg: ${err.message}`,
        );
      }
    }
  },
});
