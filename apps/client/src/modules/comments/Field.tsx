import { useLayoutEffect, useRef } from '@cdd-team/react';
import styles from './Field.module.css';

/** Свойства {@link Field}. */
interface FieldProps {
    id: string;
    label: string;
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onInput: (value: string) => void;
    /** Ctrl/Cmd+Enter — отправить */
    onSubmit: () => void;
    /** Esc внутри поля; без обработчика Esc всплывает дальше */
    onEscape?: () => void;
}

/** Поле комментария: растёт по высоте и переносит текст (макет «Длинный комментарий»). */
export function Field({
    id,
    label,
    value,
    placeholder,
    disabled,
    onInput,
    onSubmit,
    onEscape,
}: FieldProps) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            id={id}
            className={styles.field}
            value={value}
            placeholder={placeholder}
            aria-label={label}
            rows={1}
            disabled={disabled}
            onInput={(event) => onInput((event.target as HTMLTextAreaElement).value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    onSubmit();
                } else if (event.key === 'Escape' && onEscape) {
                    event.stopPropagation();
                    onEscape();
                }
            }}
        />
    );
}
