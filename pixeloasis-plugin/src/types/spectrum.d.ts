declare namespace JSX {
  interface IntrinsicElements {
    "sp-theme": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      color?: string;
      scale?: string;
      system?: string;
    };
    "sp-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      variant?: string;
      treatment?: string;
      size?: string;
      disabled?: boolean;
    };
    "sp-card": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "sp-divider": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      size?: string;
      vertical?: boolean;
    };
    "sp-field-label": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      for?: string;
      sideLabel?: boolean;
    };
    "sp-progress-circle": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      size?: string;
      indeterminate?: boolean;
      progress?: number;
    };
    "sp-textfield": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      id?: string;
      value?: string;
      placeholder?: string;
      type?: string;
      multiline?: boolean;
      rows?: number;
      quiet?: boolean;
      disabled?: boolean;
      invalid?: boolean;
    };
  }
}
