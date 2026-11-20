import { THEME_CHOICES, type ThemePreference } from '@nexa/shared-types/renderer'
import { THEME_LABELS } from '../theme.js'
import { UiIcon, type UiIconName } from './UiIcon.js'

const THEME_ICONS: Record<ThemePreference, UiIconName> = {
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
}

/**
 * Ba nút bật/tắt trong một nhóm, không phải radiogroup: nhóm nút giữ Tab đi qua từng lựa chọn
 * như mọi control khác trong Cài đặt, còn radiogroup thì phải tự dựng lại roving tabindex.
 */
export function ThemeSwitch(props: {
  value: ThemePreference
  onChange: (next: ThemePreference) => void
}): React.JSX.Element {
  return (
    <div className="theme-switch" role="group" aria-label="Màu giao diện">
      {THEME_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          className="theme-switch-option"
          aria-pressed={props.value === choice}
          onClick={() => props.onChange(choice)}
        >
          <UiIcon name={THEME_ICONS[choice]} size={18} />
          {THEME_LABELS[choice]}
        </button>
      ))}
    </div>
  )
}
