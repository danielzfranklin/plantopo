import dataMap from './preview.json';

export default function SpritePreview({
  sprite,
  size,
  color,
  opacity,
}: {
  sprite: string | undefined;
  size: number;
  color?: string;
  opacity?: number;
}) {
  const data = sprite === undefined ? undefined : (dataMap[sprite] as string);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: data ?? '' }}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fill: color,
        opacity,
      }}
    />
  );
}
