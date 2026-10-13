import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(path: React.ReactNode) {
  return function Icon({ size = 22, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        {path}
      </svg>
    );
  };
}

export const IconHome = make(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>);
export const IconHistory = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconList = make(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>);
export const IconDumbbell = make(<><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" /></>);
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconDots = make(<><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>);
export const IconBack = make(<path d="M15 5l-7 7 7 7" />);
export const IconChevron = make(<path d="m9 6 6 6-6 6" />);
export const IconTimer = make(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></>);
export const IconTrash = make(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const IconEdit = make(<><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>);
export const IconPlay = make(<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" />);
export const IconUp = make(<path d="m6 15 6-6 6 6" />);
export const IconDown = make(<path d="m6 9 6 6 6-6" />);
export const IconSwap = make(<><path d="M4 8h14l-3-3M20 16H6l3 3" /></>);
export const IconLink = make(<><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>);
export const IconUpload = make(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>);
export const IconDownload = make(<><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v4h16v-4" /></>);
export const IconTrophy = make(<><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3M12 13v4M8 21h8M9 17h6" /></>);
export const IconCalendar = make(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const IconSparkle = make(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />);
export const IconCopy = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>);
export const IconNote = make(<><path d="M5 4h14v16H5z" /><path d="M9 9h6M9 13h6M9 17h3" /></>);
