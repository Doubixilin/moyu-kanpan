export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StoredWindowBounds {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

const MIN_VISIBLE_WIDTH = 64;
const MIN_VISIBLE_HEIGHT = 48;

export function ensureVisibleWindowBounds(
  saved: StoredWindowBounds,
  workAreas: Rectangle[],
  fallbackWorkArea: Rectangle
): Rectangle {
  const width = Math.min(
    Math.max(Math.round(saved.width), 260),
    Math.max(260, fallbackWorkArea.width)
  );
  const height = Math.min(
    Math.max(Math.round(saved.height), 180),
    Math.max(180, fallbackWorkArea.height)
  );

  if (saved.x != null && saved.y != null) {
    const candidate = {
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width,
      height
    };
    if (
      workAreas.some(
        (area) =>
          visibleWidth(candidate, area) >= MIN_VISIBLE_WIDTH &&
          visibleHeight(candidate, area) >= MIN_VISIBLE_HEIGHT
      )
    ) {
      return candidate;
    }
  }

  return {
    x: Math.round(fallbackWorkArea.x + (fallbackWorkArea.width - width) / 2),
    y: Math.round(fallbackWorkArea.y + (fallbackWorkArea.height - height) / 2),
    width,
    height
  };
}

function visibleWidth(bounds: Rectangle, area: Rectangle): number {
  return Math.max(
    0,
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  );
}

function visibleHeight(bounds: Rectangle, area: Rectangle): number {
  return Math.max(
    0,
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  );
}
