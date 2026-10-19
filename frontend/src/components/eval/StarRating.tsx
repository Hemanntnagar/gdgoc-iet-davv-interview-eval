import { RATING_DESCRIPTIONS, STAR_MAX, STAR_MIN } from '../../lib/rubric';

/**
 * Clickable 1–5 star rating with the exact rating descriptions from the rubric.
 * Keyboard accessible (radio-group semantics), never fabricates a value:
 * an unrated criterion is null until the interviewer clicks.
 */
export function StarRating({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const stars: number[] = [];
  for (let i = STAR_MIN; i <= STAR_MAX; i++) stars.push(i);
  return (
    <div className="star-rating" role="radiogroup" aria-label={label}>
      {stars.map((n) => {
        const active = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''} — ${RATING_DESCRIPTIONS[n] ?? ''}`}
            className={`star ${active ? 'on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(value === n ? null : n)}
            title={`${n} — ${RATING_DESCRIPTIONS[n] ?? ''}`}
          >
            {active ? '★' : '☆'}
          </button>
        );
      })}
      <span className="star-caption" aria-live="polite">
        {value === null ? 'Not rated' : `${value} — ${RATING_DESCRIPTIONS[value] ?? ''}`}
      </span>
    </div>
  );
}
