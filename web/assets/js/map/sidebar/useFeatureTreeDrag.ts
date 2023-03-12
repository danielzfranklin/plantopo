import { useEffect, useState } from 'react';
import { idxOfAt, serializeAt, idxBetween } from '../features/algorithms';
import { ROOT_FEATURE } from '../features/types';
import { setActive, updateFeature } from '../features/slice';
import { useAppDispatch } from '../hooks';

const DT_TYPE = 'plantopo/feature';
const ROOT = 'feature-tree__root';
const FEATURE = 'feature-tree__parent';
const INSERTPOINT = 'feature-tree__insertpoint';

export type DragState = {
  type: 'dragState';
  id: string;
  beforeIdx: string | undefined;
  afterIdx: string | undefined;
  parentId: string;
  at: string;
};

export default function useFeatureTreeDrag(): DragState | undefined {
  const dispatch = useAppDispatch();
  const [pubState, setPubState] = useState<DragState | undefined>();

  useEffect(() => {
    let draggedElem: HTMLElement | null;
    let state: DragState | undefined;

    const handler = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const dt = e.dataTransfer;

      if (e.type === 'dragstart') {
        const targetFeatElem = closestFeature(e.target as HTMLElement);
        if (!targetFeatElem) return;
        const id = elemFeature(targetFeatElem);
        if (!id) throw new Error('unreachable');

        dt.effectAllowed = 'move';
        dt.setData(DT_TYPE, 'move');

        draggedElem = targetFeatElem as HTMLElement;

        dispatch(setActive(draggedElem.dataset.feature));

        const { beforeIdx, afterIdx, parentId } = computePos(
          draggedElem,
          'after',
        );
        const at = serializeAt(parentId, idxBetween(beforeIdx, afterIdx));
        state = {
          id,
          beforeIdx,
          afterIdx,
          parentId,
          at,
          type: 'dragState',
        };
        setPubState(state);
      } else if (state && draggedElem && e.type === 'dragover') {
        e.preventDefault(); // allow drag over
        const { clientY } = e;

        // For the x we just want anything inside the tree
        let elemDraggedOver = document.elementFromPoint(20, clientY);

        if (elemDraggedOver?.classList.contains(INSERTPOINT)) {
          const bbox = elemDraggedOver.getBoundingClientRect();
          const belowInsertpoint = clientY + bbox.height + 1;
          elemDraggedOver = document.elementFromPoint(20, belowInsertpoint);
        }

        let potentialOverlap = elemDraggedOver;
        while (potentialOverlap) {
          if (potentialOverlap === draggedElem) {
            elemDraggedOver = draggedElem.nextElementSibling;
          }
          potentialOverlap = potentialOverlap.parentElement;
        }

        if (!(elemDraggedOver instanceof HTMLElement)) return;
        const targetFeat = closestFeature(elemDraggedOver);

        let pos;

        if (targetFeat && targetFeat === draggedElem) {
          // disallowed, keep the insert marker wherever it was before
          return;
        } else if (targetFeat && targetFeat.dataset.featureType === 'group') {
          // Possibly nested under targetFeat
          const targetBox = targetFeat.getBoundingClientRect();
          const beforeTargetBottom = targetBox.y + targetBox.height / 3;
          const afterTargetTop = beforeTargetBottom + targetBox.height / 3;

          if (clientY < beforeTargetBottom) {
            pos = 'before';
          } else if (clientY > afterTargetTop) {
            pos = 'after';
          } else {
            pos = 'firstChild';
          }
        } else if (targetFeat) {
          // Right before or after and at the same level as targetFeat
          const targetBox = targetFeat.getBoundingClientRect();
          const targetMiddle = targetBox.y + targetBox.height / 2;
          if (clientY < targetMiddle) {
            pos = 'before';
          } else {
            pos = 'after';
          }
        } else {
          // Before first or after last

          // Since we keep dragged elements in the DOM there needs to be at
          // least one to get here
          const all = document.getElementsByClassName(FEATURE);
          const first = all[0] as HTMLElement;
          const firstBox = first.getBoundingClientRect();

          if (clientY < firstBox.top + firstBox.height / 2) {
            pos = 'first';
          } else {
            pos = 'last';
          }
        }

        const update = computePos(targetFeat, pos);
        if (
          update.parentId != state.parentId ||
          update.beforeIdx != state.beforeIdx ||
          update.afterIdx != state.afterIdx
        ) {
          const at = serializeAt(
            update.parentId,
            idxBetween(update.beforeIdx, update.afterIdx),
          );
          state = {
            ...state!,
            beforeIdx: update.beforeIdx,
            afterIdx: update.afterIdx,
            parentId: update.parentId,
            at,
          };
          setPubState(state);
        }
      } else if (draggedElem && e.type === 'drop') {
        if (!state) return;

        dispatch(updateFeature(state.id, { at: state.at }));

        draggedElem = null;
        state = undefined;
        setPubState(state);
      } else if (draggedElem && e.type === 'dragend') {
        draggedElem = null;
        state = undefined;
        setPubState(state);
      }
    };

    window.addEventListener('dragover', handler);
    window.addEventListener('dragstart', handler);
    window.addEventListener('drop', handler);
    window.addEventListener('dragend', handler);

    return () => {
      window.removeEventListener('dragover', handler);
      window.removeEventListener('dragstart', handler);
      window.removeEventListener('drop', handler);
      window.removeEventListener('dragend', handler);
    };
  }, [dispatch, setPubState]);

  return pubState;
}

const computePos = (
  targetFeat: HTMLElement | null,
  pos: 'firstChild' | 'before' | 'after' | 'first' | 'last',
): Pick<DragState, 'beforeIdx' | 'afterIdx' | 'parentId'> => {
  let beforeIdx: string | undefined;
  let afterIdx: string | undefined;
  let parentId: string;

  if (!targetFeat) {
    if (pos === 'first') {
      parentId = ROOT_FEATURE;
      beforeIdx = undefined;
      const afterAt = elemAt(document.querySelector(`.${FEATURE}`));
      afterIdx = afterAt ? idxOfAt(afterAt) : undefined;
    } else if (pos === 'last') {
      parentId = ROOT_FEATURE;
      const list = document.querySelectorAll(`.${ROOT} > .${FEATURE}`);
      const beforeAt = elemAt(list[list.length - 1]);
      beforeIdx = beforeAt ? idxOfAt(beforeAt) : undefined;
      afterIdx = undefined;
    } else {
      throw new Error('if targetFeat null, pos must be first|last');
    }
  } else {
    const targetId = targetFeat.dataset.feature;
    const targetAt = targetFeat.dataset.featureAt;
    if (!targetId || !targetAt) throw new Error('unreachable');
    const targetIdx = idxOfAt(targetAt);

    if (pos === 'firstChild') {
      beforeIdx = undefined;
      const afterAt = elemAt(targetFeat.querySelector(`.${FEATURE}`));
      afterIdx = afterAt ? idxOfAt(afterAt) : undefined;
      parentId = targetId;
    } else if (pos === 'before') {
      const parentElem = closestFeature(targetFeat.parentElement);
      parentId = elemFeature(parentElem) ?? ROOT_FEATURE;

      let prevElem = targetFeat.previousElementSibling;
      if (prevElem && prevElem.classList.contains(INSERTPOINT)) {
        prevElem = prevElem.previousElementSibling;
      }
      const beforeAt = elemAt(prevElem);
      beforeIdx = beforeAt ? idxOfAt(beforeAt) : undefined;

      afterIdx = targetIdx;
    } else if (pos === 'after') {
      const parentElem = closestFeature(targetFeat.parentElement);
      parentId = elemFeature(parentElem) ?? ROOT_FEATURE;
      beforeIdx = targetIdx;

      let afterElem = targetFeat.nextElementSibling;
      if (afterElem && afterElem.classList.contains(INSERTPOINT)) {
        afterElem = afterElem.nextElementSibling;
      }
      const afterAt = elemAt(afterElem);
      afterIdx = afterAt ? idxOfAt(afterAt) : undefined;
    } else {
      throw new Error('unreachable');
    }
  }

  return {
    beforeIdx,
    afterIdx,
    parentId,
  };
};

const closestFeature = (el: Element | null) =>
  el?.closest(`.${FEATURE}`) as HTMLElement | null;

const elemFeature = (el: Element | null) => {
  if (!el) return undefined;
  const id = el.getAttribute('data-feature');
  if (!id) throw new Error('unreachable');
  return id;
};

const elemAt = (el: Element | null | undefined) => {
  if (!el) return undefined;
  const at = el.getAttribute('data-feature-at');
  if (!at) throw new Error('unreachable');
  return at;
};
