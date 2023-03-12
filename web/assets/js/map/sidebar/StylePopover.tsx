import * as Popover from '@radix-ui/react-popover';
import { Cross2Icon } from '@radix-ui/react-icons';
import './stylePopover.css';
import { Feature, PointFeature } from '../features/types';
import { useAppDispatch } from '../hooks';
import { updateFeature } from '../features/slice';
import SpritePicker from '../sprite/SpritePicker';

export default function StylePopover({ feature }: { feature: Feature }) {
  return (
    <Popover.Content
      className="StylePopoverContent"
      sideOffset={-9}
      collisionPadding={10}
    >
      <div className="flex flex-col">
        {feature.type === 'point' && <PointEditor feature={feature} />}
      </div>
    </Popover.Content>
  );
}

const PointEditor = ({ feature }: { feature: PointFeature }) => {
  const dispatch = useAppDispatch();

  return (
    <div>
      <SpritePicker
        value={feature.style?.['icon-image']}
        onChange={(value) =>
          dispatch(
            updateFeature(feature.id, { style: { 'icon-image': value } }),
          )
        }
      />

      <Popover.Arrow className="StylePopoverArrow" />
      <Popover.Close className="StylePopoverClose">
        <Cross2Icon />
      </Popover.Close>
    </div>
  );
};
