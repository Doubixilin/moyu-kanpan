export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export function quickWindowBounds(
  tray: Rectangle,
  workArea: Rectangle,
  size: Size,
  margin = 8
): Rectangle {
  const distances = {
    top: Math.abs(tray.y - workArea.y),
    bottom: Math.abs(workArea.y + workArea.height - (tray.y + tray.height)),
    left: Math.abs(tray.x - workArea.x),
    right: Math.abs(workArea.x + workArea.width - (tray.x + tray.width))
  };
  const edge = tray.y >= workArea.y + workArea.height
    ? "bottom"
    : tray.y + tray.height <= workArea.y
      ? "top"
      : tray.x >= workArea.x + workArea.width
        ? "right"
        : tray.x + tray.width <= workArea.x
          ? "left"
          : (Object.entries(distances) as Array<[keyof typeof distances, number]>)
            .sort((a, b) => a[1] - b[1])[0]![0];
  let x = tray.x + tray.width - size.width;
  let y = tray.y - size.height - margin;
  if (edge === "top") y = tray.y + tray.height + margin;
  if (edge === "left") {
    x = tray.x + tray.width + margin;
    y = tray.y + tray.height - size.height;
  }
  if (edge === "right") {
    x = tray.x - size.width - margin;
    y = tray.y + tray.height - size.height;
  }
  return {
    x: clamp(Math.round(x), workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(Math.round(y), workArea.y, workArea.y + workArea.height - size.height),
    width: size.width,
    height: size.height
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
