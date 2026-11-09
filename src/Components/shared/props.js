// Helpers for the props many components share: `size` and `className`.
// Used by Button, Input, Textarea, Checkbox, ColorPicker, FileUpload, Card,
// Details, Pagination, Loading and SideMenu.

/** The sizes every control accepts. Use it as the prop's `allowedValues`. */
export const SIZE_VALUES = ['sm', 'md', 'lg'];

/**
 * Puts `size` on the host as `data-size`, so the component's CSS decides what
 * each size looks like. An unknown value falls back to `fallback`. Returns the
 * size applied.
 */
export function applySize(element, value, fallback = 'md') {
   const size = SIZE_VALUES.includes(value) ? value : fallback;
   if (element) element.dataset.size = size;
   return size;
}

/**
 * Adds the consumer's classes to the host, next to the component's own. It
 * never removes a class, so the component keeps the ones it is styled by.
 */
export function applyClassName(element, value) {
   if (!element || typeof value !== 'string') return;
   for (const name of value.split(/\s+/)) {
      if (name) element.classList.add(name);
   }
}
