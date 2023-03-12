import { useEffect, useRef, useState } from 'react';
import classNames from '../../classNames';
import { sortFeatures } from '../features/algorithms';
import { Feature, ROOT_FEATURE } from '../features/types';
import { useAppDispatch, useAppSelector, useAppStore } from '../hooks';
import {
  selectFeaturesList,
  selectIsActiveFeature,
  selectPeersActiveOnFeature,
  setActive,
  updateFeature,
} from '../features/slice';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Popover from '@radix-ui/react-popover';
import '../components/contextMenu.css';
import useFeatureTreeDrag, { DragState } from './useFeatureTreeDrag';
import { AnimatePresence, motion } from 'framer-motion';
import SpritePreview from '../sprite/SpritePreview';
import { FolderIcon } from '@heroicons/react/24/outline';
import { RouteIcon, DropdownIcon } from '../components/icons';
import StylePopover from './StylePopover';
import FeatureContextMenu from './FeatureContextMenu';

const UNNAMED_PLACEHOLDER = {
  group: 'Unnamed folder',
  point: 'Unnamed point',
  route: 'Unnamed route',
};

const LEVEL_INDENT_PX = 15;

export default function FeatureTree() {
  const ref = useRef<HTMLDivElement>(null);
  const dragState = useFeatureTreeDrag();

  return (
    <div ref={ref} className="flex flex-col pt-1 mx-[4px] overflow-y-auto grow">
      <GroupChildren
        parentId={ROOT_FEATURE}
        isExpanded={true}
        dragState={dragState}
        level={0}
      />
    </div>
  );
}

const GroupChildren = ({
  parentId,
  isExpanded,
  dragState,
  level,
}: {
  parentId: string;
  isExpanded: boolean;
  dragState: DragState | undefined;
  level: number;
}) => {
  const featureList = useAppSelector(selectFeaturesList(parentId));

  let dragChild: DragState | undefined;
  if (dragState && dragState.parentId === parentId) {
    dragChild = dragState;
  }

  let list: (Feature | DragState)[] = [];
  if (isExpanded) {
    if (dragChild) {
      list = sortFeatures([dragChild, ...featureList]);
    } else {
      list = sortFeatures(featureList);
    }
  }

  return (
    <AnimatePresence initial={false}>
      {!isExpanded && dragChild && (
        <DragInsertPoint key="drag-insert-point" level={level} />
      )}

      {isExpanded && (
        <motion.ul
          key="children"
          className={classNames(
            parentId === ROOT_FEATURE && 'feature-tree__root',
          )}
          initial={'collapsed'}
          animate={'open'}
          exit={'collapsed'}
          variants={{
            open: {
              opacity: 1,
              height: 'auto',
            },
            collapsed: { opacity: 0, height: 0 },
          }}
        >
          {list.map((item) =>
            item.type === 'dragState' ? (
              <DragInsertPoint key="drag-insert-point" level={level} />
            ) : (
              <FeatureItem
                key={item.id}
                feature={item}
                dragState={dragState}
                level={level}
              />
            ),
          )}
        </motion.ul>
      )}
    </AnimatePresence>
  );
};

const DragInsertPoint = ({ level }: { level: number }) => (
  <motion.div
    transition={{ duration: window.appSettings.disableAnimation ? 0 : 0.1 }}
    layoutId="drag-insert-point"
    className="feature-tree__insertpoint h-[1px] mx-auto bg-blue-500"
    style={{ marginLeft: `${level * LEVEL_INDENT_PX}px` }}
  />
);

function FeatureItem({
  feature,
  dragState,
  level,
}: {
  feature: Feature;
  dragState: DragState | undefined;
  level: number;
}) {
  const { id, type } = feature;

  const dispatch = useAppDispatch();
  const store = useAppStore();
  const isActive = useAppSelector(selectIsActiveFeature(feature.id));
  const activePeers = useAppSelector(selectPeersActiveOnFeature(feature.id));
  const [isRename, setIsRename] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const isDragged = dragState && dragState.id === feature.id;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const state = store.getState();
      if (selectIsActiveFeature(id)(state)) {
        const { key, altKey, ctrlKey } = e;
        if (!ctrlKey && altKey && key === 'r') {
          setIsRename(true);
          e.preventDefault();
        } else if (!ctrlKey && !altKey && key === 'Enter') {
          setIsExpanded((prev) => !prev);
          e.preventDefault();
        } else if (!ctrlKey && altKey && key === 's') {
          setStyleOpen(true);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [id, store, setIsRename, setIsExpanded, setStyleOpen]);

  if (type !== 'group' && type !== 'point' && type !== 'route') {
    console.info(`Unknown feature [type=${feature.type}]`, feature);
    return <></>;
  }

  return (
    <motion.li
      draggable={isRename ? 'false' : 'true'}
      data-feature={feature.id}
      data-feature-type={feature.type}
      data-feature-at={feature.at}
      className="feature-tree__parent"
      layoutId={feature.id}
      animate={isDragged ? 'dragged' : 'rest'}
      variants={{
        rest: { opacity: 1 },
        dragged: { opacity: 0.4 },
      }}
    >
      <Popover.Root open={styleOpen} onOpenChange={setStyleOpen} modal={true}>
        <div
          className={classNames(
            'flex flex-row items-center gap-[6px] feature-tree__item grow',
            isActive && 'bg-blue-100',
            activePeers.length > 0 && 'border-dashed border-purple-500',
          )}
          style={{
            paddingLeft: `${level * LEVEL_INDENT_PX}px`,
          }}
        >
          <button
            disabled={feature.type !== 'group'}
            onClick={() => setIsExpanded(!isExpanded)}
            className="pl-[3px] self-stretch disabled:opacity-0"
          >
            <DropdownIcon className={classNames(!isExpanded && '-rotate-90')} />
          </button>

          <Popover.Trigger className="flex flex-col justify-center">
            <PreviewIcon feature={feature} />
          </Popover.Trigger>

          <ContextMenu.Root
            onOpenChange={(isOpen) => isOpen && dispatch(setActive(feature.id))}
          >
            <ContextMenu.Trigger asChild>
              <button
                onClick={() => {
                  if (isActive) setIsRename(true);
                  else dispatch(setActive(feature.id));
                }}
                className="flex flex-row items-center overflow-x-hidden text-sm text-left truncate grow"
              >
                {isRename ? (
                  <input
                    placeholder={UNNAMED_PLACEHOLDER[feature.type]}
                    value={feature.name || ''}
                    onChange={(e) =>
                      dispatch(
                        updateFeature(feature.id, { name: e.target.value }),
                      )
                    }
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => setIsRename(false)}
                    onKeyDown={(e) =>
                      (e.key === 'Escape' || e.key === 'Enter') &&
                      setIsRename(false)
                    }
                    className="bg-blue-100 outline-none grow"
                  />
                ) : (
                  <span
                    className={classNames(
                      'grow',
                      !feature.name && 'opacity-60',
                    )}
                  >
                    {feature.name || UNNAMED_PLACEHOLDER[feature.type]}
                  </span>
                )}
              </button>
            </ContextMenu.Trigger>
            <FeatureContextMenu
              feature={feature}
              setIsRename={setIsRename}
              setStyleOpen={setStyleOpen}
            />
          </ContextMenu.Root>
        </div>

        <StylePopover feature={feature} />
      </Popover.Root>

      {type === 'group' && (
        <GroupChildren
          parentId={feature.id}
          isExpanded={isExpanded}
          dragState={dragState}
          level={level + 1}
        />
      )}
    </motion.li>
  );
}
const PreviewIcon = ({ feature }: { feature: Feature }) => {
  if (feature.type === 'group') {
    return <FolderIcon height="20px" />;
  } else if (feature.type === 'point') {
    const sprite = feature.style?.['icon-image'];

    return (
      <SpritePreview
        sprite={sprite}
        color={feature.style?.['icon-color'] ?? 'black'}
        opacity={feature.style?.['icon-opacity'] ?? 1}
        size={20}
      />
    );
  } else if (feature.type === 'route') {
    return (
      <RouteIcon
        height="18px"
        fill={feature.lineStyle?.['line-color'] ?? 'black'}
        opacity={feature.lineStyle?.['line-opacity'] ?? 1}
      />
    );
  } else {
    return <></>;
  }
};
