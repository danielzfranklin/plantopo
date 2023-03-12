import { ChevronDownIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useMemo, useState } from 'react';
import classNames from '../../classNames';
import Tooltip from '../components/Tooltip';
import { selectCommonSprites } from '../features/slice';
import { useAppStore } from '../hooks';
import data from './preview.json';
import SpritePreview from './SpritePreview';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, motion } from 'framer-motion';

const sortedSpriteNames = Array.from(Object.keys(data)).sort();

interface Props {
  value?: string;
  onChange: OnChange;
}

type OnChange = (value: string | undefined) => void;

const SpritePicker = ({ value, onChange }: Props) => {
  const store = useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);
  // Never changes for an open popup
  const common = useMemo(() => selectCommonSprites(store.getState()), [store]);
  const valueNotInCommon =
    value === undefined ? false : !common.includes(value);

  return (
    <Popover.Root
      open={isExpanded}
      onOpenChange={(isOpen) => setIsExpanded(isOpen)}
    >
      <Popover.Anchor
        className={classNames(
          'flex flex-row p-1 justify-between overflow-hidden border border-gray-300 rounded-sm',
        )}
      >
        <div className="flex flex-row">
          {common.slice(0, valueNotInCommon ? -1 : undefined).map((sprite) => (
            <Button
              key={sprite}
              sprite={sprite}
              isSelected={value === sprite}
              onChange={onChange}
            />
          ))}

          <AnimatePresence initial={false}>
            {valueNotInCommon && (
              <Button
                key={value}
                sprite={value!}
                isSelected={true}
                onChange={onChange}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="flex ml-1">
          <Tooltip title="No icon" key="no-icon">
            <button
              onClick={() => onChange(undefined)}
              className={classNames(
                'rounded-full p-[3px]',
                value === undefined && 'bg-blue-100',
              )}
            >
              <EyeSlashIcon className="h-[20px] stroke-gray-500" />
            </button>
          </Tooltip>

          <Popover.Trigger asChild>
            <motion.button
              animate={isExpanded ? 'expanded' : 'closed'}
              variants={{
                expanded: { rotateZ: 180 },
                closed: { rotateZ: 0 },
              }}
            >
              <ChevronDownIcon className="h-[20px] px-1" />
            </motion.button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>

      <ExpandedContent
        value={value}
        onChange={(value) => {
          setIsExpanded(false);
          onChange(value);
        }}
      />
    </Popover.Root>
  );
};

const ExpandedContent = ({
  onChange,
  value,
}: {
  onChange: OnChange;
  value: string | undefined;
}) => {
  return (
    <Popover.Content
      align="start"
      className="w-[var(--radix-popover-trigger-width)] bg-white p-1 border border-t-0 border-gray-300 rounded-sm"
    >
      {sortedSpriteNames.map((sprite) => (
        <Button
          key={sprite}
          sprite={sprite}
          isSelected={value === sprite}
          onChange={onChange}
        />
      ))}
    </Popover.Content>
  );
};

const Button = (props: {
  isSelected: boolean;
  onChange: OnChange;
  sprite: string;
}) => (
  <button
    onClick={() => props.onChange(props.sprite)}
    className={classNames(
      'rounded-full p-[1px]',
      props.isSelected && 'bg-blue-100',
    )}
  >
    <SpritePreview sprite={props.sprite} size={20} />
  </button>
);

export default SpritePicker;
