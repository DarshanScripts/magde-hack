import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const HANDSET =
  "M5 4h3.5l1.7 4.3-2.1 1.5a12.5 12.5 0 0 0 6.1 6.1l1.5-2.1L20 15.5V19a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z";

export const PhoneIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d={HANDSET} />
  </Icon>
);

export const HangUpIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d={HANDSET} transform="rotate(135 12 12)" />
  </Icon>
);

export const SpeakerIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.3a7.8 7.8 0 0 1 0 11.4" />
  </Icon>
);

export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Icon>
);

export const MicOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M15 10.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11.5a6.5 6.5 0 0 0 10.4 5.2M18.5 11.5c0 .9-.2 1.8-.5 2.6M12 18v3M4 4l16 16" />
  </Icon>
);

export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const HandIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6M14 11V6a1.5 1.5 0 0 1 3 0v8.5a6.5 6.5 0 0 1-12 3.4l-2-3.6a1.5 1.5 0 0 1 2.5-1.6L8 15" />
  </Icon>
);

export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);
