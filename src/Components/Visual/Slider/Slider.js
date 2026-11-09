// Slider — pick a number (or a [low, high] range) by dragging or with the keyboard.
//
// Built on native `<input type="range">`, one per thumb, laid over a drawn track.
// That is the point of the design: the browser supplies the keyboard model
// (←/→/↑/↓ by `step`, PageUp/PageDown, Home/End), touch and pointer dragging,
// `aria-valuenow/min/max` and form submission, and gets them right on every
// engine. The component only draws the track, the fill, the marks and the
// value, and keeps the two thumbs of a range from crossing.
//
// Enumerated vocabularies are LITERAL arrays in `static props`, read back by the
// setters (COMPONENT_API_STANDARDS.md §10).

let _sliceSliderSeq = 0;

export default class Slider extends HTMLElement {

   static props = {
      min: {
         type: 'number',
         default: 0
      },
      max: {
         type: 'number',
         default: 100
      },
      // Granularity. Decimals work (0.1, 0.25); values snap to it from `min`.
      step: {
         type: 'number',
         default: 1
      },
      // A number, or `[low, high]` when `range` is true. Clamped to min/max and
      // snapped to `step`. Declared `number`; the array form is the range mode.
      value: {
         type: 'number',
         default: 0
      },
      // Two thumbs: `value` becomes `[low, high]` and they cannot cross.
      range: {
         type: 'boolean',
         default: false
      },
      label: {
         type: 'string',
         default: null
      },
      // Native `name` on the input(s), so a surrounding <form> submits the value
      // (both thumbs under the same name in range mode).
      name: {
         type: 'string',
         default: null
      },
      disabled: {
         type: 'boolean',
         default: false
      },
      // Show the current value next to the label.
      showValue: {
         type: 'boolean',
         default: true
      },
      // `(value) => string` for the visible value AND `aria-valuetext`, so a
      // screen reader hears "$40" or "40 %", not a bare number.
      formatValue: {
         type: 'function',
         default: null
      },
      // Labelled stops under the track: numbers, or `{ value, label }`.
      // Clicking one moves the nearest thumb there.
      marks: {
         type: 'array',
         default: null
      },
      variant: {
         type: 'string',
         default: 'default',
         allowedValues: ['default', 'outlined', 'soft', 'plain']
      },
      size: {
         type: 'string',
         default: 'md',
         allowedValues: ['sm', 'md', 'lg']
      },
      // Fired continuously while the value changes (dragging, held arrow key).
      onInput: {
         type: 'function',
         default: null
      },
      // Fired once the user commits a value (thumb released, key pressed, mark
      // clicked). Never for programmatic changes. Canonical handler (§3.1).
      onChange: {
         type: 'function',
         default: null
      },
      // `{ accent }` (§6): the fill and thumb colour.
      customColor: {
         type: 'object',
         default: null
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$container = this.querySelector('.slice_slider_container');
      this.$label = this.querySelector('.slice_slider_label');
      this.$output = this.querySelector('.slice_slider_value');
      this.$control = this.querySelector('.slice_slider_control');
      this.$low = this.querySelector('.slice_slider_input--low');
      this.$high = this.querySelector('.slice_slider_input--high');
      this.$marks = this.querySelector('.slice_slider_marks');

      // Internal state uses names no declared prop can derive (§10).
      this._uid = `slice-slider-${++_sliceSliderSeq}`;
      this._mounted = false;
      this.$label.id = `${this._uid}-label`;
      this.$low.id = `${this._uid}-low`;
      this.$high.id = `${this._uid}-high`;

      // Listeners on the component's own nodes are auto-cleaned with it.
      this._onThumbInput = this._onThumbInput.bind(this);
      this._onThumbChange = this._onThumbChange.bind(this);
      this._onMarkClick = this._onMarkClick.bind(this);
      this._onTrackPointerDown = this._onTrackPointerDown.bind(this);
      for (const input of [this.$low, this.$high]) {
         input.addEventListener('input', this._onThumbInput);
         input.addEventListener('change', this._onThumbChange);
      }
      this.$marks.addEventListener('click', this._onMarkClick);
      this.$control.addEventListener('pointerdown', this._onTrackPointerDown);

      slice.controller.setComponentProps(this, props);
   }

   init() {
      // Props arrive in the caller's key order, so `value: 150, max: 200` would
      // clamp 150 to the default max of 100 if it were applied on arrival. The
      // setters only record until now; the first real render happens here.
      this._mounted = true;
      this._value = this._normalize(this._value);
      this._render();
   }

   // ------------------------------------------------------------- numbers

   _bounds() {
      const min = Number.isFinite(this._min) ? this._min : 0;
      let max = Number.isFinite(this._max) ? this._max : 100;
      if (max < min) max = min;
      const step = Number.isFinite(this._step) && this._step > 0 ? this._step : 1;
      return { min, max, step };
   }

   _decimals(n) {
      const text = String(n);
      if (text.includes('e-')) return Number(text.split('e-')[1]);
      return text.includes('.') ? text.split('.')[1].length : 0;
   }

   // Clamp, then snap to the nearest step counted from `min`, then strip float
   // noise (0.1 + 0.2) by rounding to the precision of min and step.
   _snap(n) {
      const { min, max, step } = this._bounds();
      const x = Number(n);
      if (!Number.isFinite(x)) return min;
      const clamped = Math.min(max, Math.max(min, x));
      const snapped = min + Math.round((clamped - min) / step) * step;
      const digits = Math.max(this._decimals(step), this._decimals(min));
      return Math.min(max, Number(snapped.toFixed(digits)));
   }

   _normalize(value) {
      const { min, max } = this._bounds();
      if (this._range) {
         const pair = Array.isArray(value) ? value : [min, max];
         let low = this._snap(pair[0] ?? min);
         let high = this._snap(pair[1] ?? max);
         if (low > high) [low, high] = [high, low];
         return [low, high];
      }
      const single = Array.isArray(value) ? value[0] : value;
      return this._snap(single ?? min);
   }

   _fraction(n) {
      const { min, max } = this._bounds();
      return max === min ? 0 : (n - min) / (max - min);
   }

   _format(n) {
      if (typeof this._formatValue === 'function') {
         try {
            return String(this._formatValue(n));
         } catch (error) {
            slice.logger?.logError?.('Slider', 'formatValue() threw', error);
         }
      }
      return String(n);
   }

   // ---------------------------------------------------------- rendering

   _render() {
      if (!this._mounted) return;
      const { min, max, step } = this._bounds();
      const range = this._range === true;
      const [low, high] = range ? this._value : [min, this._value];

      for (const input of [this.$low, this.$high]) {
         input.min = String(min);
         input.max = String(max);
         input.step = String(step);
         input.disabled = this._disabled === true;
      }
      // Set after min/max/step: the native input clamps and snaps on assignment.
      this.$low.value = String(range ? low : this._value);
      this.$high.value = String(high);
      this.$high.hidden = !range;
      this.$container.classList.toggle('slice_slider--range', range);

      this._paint();
      this._renderMarks();
      this._applyNames();
   }

   // The cheap part of a render, run on every drag frame.
   _paint() {
      const range = this._range === true;
      const { min } = this._bounds();
      const [low, high] = range ? this._value : [min, this._value];

      this.$control.style.setProperty('--slice-slider-start', String(this._fraction(low)));
      this.$control.style.setProperty('--slice-slider-end', String(this._fraction(high)));

      this.$low.setAttribute('aria-valuetext', this._format(range ? low : high));
      if (range) this.$high.setAttribute('aria-valuetext', this._format(high));

      this.$output.textContent = range ? `${this._format(low)} – ${this._format(high)}` : this._format(high);
      this.$output.hidden = this._showValue === false;

      // When both thumbs sit at the top end, the low one must be on top or it
      // could never be dragged back down.
      const { max } = this._bounds();
      this.$low.classList.toggle('slice_slider_input--raised', range && low >= max);
   }

   _renderMarks() {
      const marks = Array.isArray(this._marks) ? this._marks : [];
      const { min, max } = this._bounds();
      const nodes = [];
      for (const entry of marks) {
         const value = typeof entry === 'object' && entry !== null ? Number(entry.value) : Number(entry);
         if (!Number.isFinite(value) || value < min || value > max) continue;
         const text = typeof entry === 'object' && entry !== null && entry.label !== undefined
            ? String(entry.label)
            : this._format(value);
         const mark = document.createElement('button');
         mark.type = 'button';
         mark.className = 'slice_slider_mark';
         mark.dataset.value = String(value);
         mark.textContent = text;
         // The thumbs are the keyboard path; marks are a pointer shortcut and
         // would only add N extra tab stops.
         mark.tabIndex = -1;
         mark.style.setProperty('--slice-slider-mark-at', String(this._fraction(value)));
         nodes.push(mark);
      }
      this.$marks.replaceChildren(...nodes);
      this.$marks.hidden = nodes.length === 0;
   }

   _applyNames() {
      const range = this._range === true;
      if (this._label) {
         if (range) {
            // Two controls cannot share one name: each says which end it is.
            this.$low.removeAttribute('aria-labelledby');
            this.$high.removeAttribute('aria-labelledby');
            this.$low.setAttribute('aria-label', `${this._label} (minimum)`);
            this.$high.setAttribute('aria-label', `${this._label} (maximum)`);
         } else {
            this.$low.removeAttribute('aria-label');
            this.$low.setAttribute('aria-labelledby', this.$label.id);
         }
      } else {
         this.$low.removeAttribute('aria-labelledby');
         this.$high.removeAttribute('aria-labelledby');
         this.$low.setAttribute('aria-label', range ? 'Minimum' : 'Value');
         this.$high.setAttribute('aria-label', 'Maximum');
      }
      for (const input of [this.$low, this.$high]) {
         if (this._name) input.name = this._name; else input.removeAttribute('name');
      }
   }

   // -------------------------------------------------------------- events

   _readThumbs(moved) {
      const low = this._snap(this.$low.value);
      if (!this._range) return low;
      let high = this._snap(this.$high.value);
      // A thumb may not pass the other one: it stops where the other sits.
      if (low > high) {
         if (moved === this.$low) {
            this.$low.value = String(high);
            return [high, high];
         }
         this.$high.value = String(low);
         return [low, low];
      }
      return [low, high];
   }

   _same(a, b) {
      if (Array.isArray(a) && Array.isArray(b)) return a[0] === b[0] && a[1] === b[1];
      return a === b;
   }

   _onThumbInput(event) {
      const next = this._readThumbs(event.target);
      if (this._same(next, this._value)) return;
      this._value = next;
      this._paint();
      if (typeof this._onInput === 'function') this._onInput(this.value);
   }

   _onThumbChange(event) {
      this._value = this._readThumbs(event.target);
      this._paint();
      if (typeof this._onChange === 'function') this._onChange(this.value);
   }

   _onMarkClick(event) {
      const mark = event.target.closest('.slice_slider_mark');
      if (!mark || this._disabled) return;
      this._moveTo(this._snap(Number(mark.dataset.value)));
   }

   // Range mode only: the inputs let a click on the bare track fall through to
   // here (single mode handles it natively), and the nearest thumb jumps there.
   _onTrackPointerDown(event) {
      if (!this._range || this._disabled) return;
      if (event.target === this.$low || event.target === this.$high) return;
      const rect = this.$control.getBoundingClientRect();
      const thumb = this.$low.getBoundingClientRect().height || 0;
      const span = rect.width - thumb;
      if (span <= 0) return;
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left - thumb / 2) / span));
      const { min, max } = this._bounds();
      this._moveTo(this._snap(min + fraction * (max - min)), true);
   }

   _moveTo(target, focusMoved = false) {
      let next;
      let moved = this.$low;
      if (this._range) {
         const [low, high] = this._value;
         // Move whichever thumb is closer (ties go to the one below the mark).
         const lowWins = Math.abs(target - low) <= Math.abs(target - high) && target <= high;
         next = lowWins ? [target, high] : [low, target];
         moved = lowWins ? this.$low : this.$high;
         if (next[0] > next[1]) next = [next[1], next[1]];
      } else {
         next = target;
      }
      if (focusMoved) moved.focus();
      if (this._same(next, this._value)) return;
      this._value = next;
      this._render();
      if (typeof this._onInput === 'function') this._onInput(this.value);
      if (typeof this._onChange === 'function') this._onChange(this.value);
   }

   // ------------------------------------------------------- public / props

   /** Focus the (low) thumb. */
   focus(options) {
      this.$low.focus(options);
   }

   get value() {
      // A copy, so callers cannot mutate the internal pair.
      return Array.isArray(this._value) ? [...this._value] : this._value;
   }

   set value(value) {
      this._value = this._mounted ? this._normalize(value) : value;
      this._render();
   }

   get min() {
      return this._min;
   }

   set min(value) {
      this._min = Number(value);
      this._reflow();
   }

   get max() {
      return this._max;
   }

   set max(value) {
      this._max = Number(value);
      this._reflow();
   }

   get step() {
      return this._step;
   }

   set step(value) {
      this._step = Number(value);
      this._reflow();
   }

   get range() {
      return this._range;
   }

   set range(value) {
      this._range = value === true;
      this._reflow();
   }

   // Bounds or mode changed after mount: re-fit the value (no events — this is
   // not user input) and redraw.
   _reflow() {
      if (!this._mounted) return;
      this._value = this._normalize(this._value);
      this._render();
   }

   get label() {
      return this._label;
   }

   set label(value) {
      this._label = value === null || value === undefined || value === '' ? null : String(value);
      this.$label.textContent = this._label || '';
      this.$label.hidden = !this._label;
      if (this._mounted) this._applyNames();
   }

   get name() {
      return this._name;
   }

   set name(value) {
      this._name = typeof value === 'string' && value ? value : null;
      if (this._mounted) this._applyNames();
   }

   get disabled() {
      return this._disabled;
   }

   set disabled(value) {
      this._disabled = value === true;
      this.$low.disabled = this._disabled;
      this.$high.disabled = this._disabled;
      this.$container.classList.toggle('slice_slider--disabled', this._disabled);
   }

   get showValue() {
      return this._showValue;
   }

   set showValue(value) {
      this._showValue = value !== false;
      this.$output.hidden = !this._showValue;
   }

   get formatValue() {
      return this._formatValue;
   }

   set formatValue(value) {
      this._formatValue = typeof value === 'function' ? value : null;
      if (this._mounted) this._render();
   }

   get marks() {
      return this._marks;
   }

   set marks(value) {
      this._marks = Array.isArray(value) ? value : null;
      if (this._mounted) this._renderMarks();
   }

   get variant() {
      return this._variant;
   }

   set variant(value) {
      const { allowedValues, default: fallback } = Slider.props.variant;
      const next = allowedValues.includes(value) ? value : fallback;
      for (const v of allowedValues) this.$container.classList.remove('slice_slider--' + v);
      this.$container.classList.add('slice_slider--' + next);
      this._variant = next;
   }

   get size() {
      return this._size;
   }

   set size(value) {
      const { allowedValues, default: fallback } = Slider.props.size;
      const next = allowedValues.includes(value) ? value : fallback;
      this.dataset.size = next;
      this._size = next;
   }

   get customColor() {
      return this._customColor;
   }

   set customColor(value) {
      this._customColor = value && typeof value === 'object' ? value : null;
      const accent = this._customColor && (this._customColor.accent ?? this._customColor.background);
      if (accent) {
         this.style.setProperty('--slice-slider-custom-accent', accent);
      } else {
         this.style.removeProperty('--slice-slider-custom-accent');
      }
   }

   get onInput() {
      return this._onInput;
   }

   set onInput(value) {
      this._onInput = typeof value === 'function' ? value : null;
   }

   get onChange() {
      return this._onChange;
   }

   set onChange(value) {
      // Accept null/non-function to CLEAR the handler.
      this._onChange = typeof value === 'function' ? value : null;
   }
}

customElements.define('slice-slider', Slider);