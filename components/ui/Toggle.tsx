import React, { useState } from 'react';
import { cx } from './cx';

export type ToggleProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
};

/** 按钮开关：aria-pressed。选中走 --accent，不是主按钮渐变。 */
export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { pressed: pressedProp, defaultPressed = false, onPressedChange, className, type = 'button', ...props },
  ref,
) {
  const [uncontrolled, setUncontrolled] = useState(defaultPressed);
  const pressed = pressedProp ?? uncontrolled;

  return (
    <button
      ref={ref}
      type={type}
      className={cx('toggle', pressed && 'on', className)}
      aria-pressed={pressed}
      {...props}
      onClick={() => {
        const next = !pressed;
        if (pressedProp === undefined) setUncontrolled(next);
        onPressedChange?.(next);
      }}
    />
  );
});

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  onCheckedChange?: (checked: boolean) => void;
};

/** 原生 checkbox 视觉开关。 */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { className, onCheckedChange, onChange, ...props },
  ref,
) {
  return (
    <label className={cx('switch', className)}>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        aria-checked={typeof props.checked === 'boolean' ? props.checked : undefined}
        {...props}
        onChange={(e) => {
          onChange?.(e);
          onCheckedChange?.(e.target.checked);
        }}
      />
      <i />
    </label>
  );
});
