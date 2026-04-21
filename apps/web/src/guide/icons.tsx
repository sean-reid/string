interface IconProps {
  size?: number;
}

const base = "inline-block";

export function IconPlay({ size = 20 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <path
        d="M8.5 5.5c0-.8.86-1.28 1.52-.87l9.3 5.68a1.02 1.02 0 0 1 0 1.74l-9.3 5.68c-.66.41-1.52-.07-1.52-.87V5.5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconPause({ size = 20 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <rect x="6.5" y="5" width="4" height="14" rx="1.25" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.25" fill="currentColor" />
    </svg>
  );
}

export function IconNext({ size = 20 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <path
        d="M5.5 5.5c0-.8.86-1.28 1.52-.87l7.9 4.82a1.02 1.02 0 0 1 0 1.74l-7.9 4.82c-.66.41-1.52-.07-1.52-.87V5.5z"
        fill="currentColor"
      />
      <rect x="16.5" y="5" width="3" height="14" rx="1.25" fill="currentColor" />
    </svg>
  );
}

export function IconPrev({ size = 20 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <rect x="4.5" y="5" width="3" height="14" rx="1.25" fill="currentColor" />
      <path
        d="M18.5 5.5v13c0 .8-.86 1.28-1.52.87L9.08 14.55a1.02 1.02 0 0 1 0-1.74l7.9-4.82c.66-.41 1.52.07 1.52.87z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconHeadphones({ size = 18 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <path
        d="M4 14a8 8 0 1 1 16 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="3"
        y="13"
        width="5"
        height="8"
        rx="2"
        fill="currentColor"
      />
      <rect
        x="16"
        y="13"
        width="5"
        height="8"
        rx="2"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconSpeaker({ size = 16 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <path
        d="M4 10v4a1 1 0 0 0 1 1h3l4 4a1 1 0 0 0 1.7-.71V5.71A1 1 0 0 0 12 5l-4 4H5a1 1 0 0 0-1 1z"
        fill="currentColor"
      />
      <path
        d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconSpeakerOff({ size = 16 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <path
        d="M4 10v4a1 1 0 0 0 1 1h3l4 4a1 1 0 0 0 1.7-.71V5.71A1 1 0 0 0 12 5l-4 4H5a1 1 0 0 0-1 1z"
        fill="currentColor"
      />
      <path
        d="M16.5 9.5L21 14M21 9.5l-4.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconPrinter({ size = 16 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <rect
        x="6"
        y="3"
        width="12"
        height="6"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect x="4" y="9" width="16" height="8" rx="2" fill="currentColor" />
      <rect
        x="7"
        y="14"
        width="10"
        height="7"
        rx="1"
        fill="#faf8f4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line
        x1="9"
        y1="17"
        x2="15"
        y2="17"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconClose({ size = 18 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
    >
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconBox({ size = 18 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
      fill="none"
    >
      <path
        d="M3.5 7.5l8.5-4 8.5 4v9l-8.5 4-8.5-4v-9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 7.5l8.5 4 8.5-4M12 11.5v9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSteps({ size = 18 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={base}
      fill="none"
    >
      <circle
        cx="6"
        cy="7"
        r="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="6"
        cy="17"
        r="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M11 7h9M11 17h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M6 9v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
