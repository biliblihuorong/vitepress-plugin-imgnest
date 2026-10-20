export interface Variant {
  url: string;
  width: number;
  height?: number;
}

export interface SourceConfig {
  type: "lookup" | "template";
  hosts: string;
  endpoint?: string;
  template?: string;
  widths?: string;
}

export interface ImgNestResponsiveOptions {
  sources: SourceConfig[];
  sizes?: string;
  writeDimensions?: boolean;
  fallbackOnError?: boolean;
  timeout?: number;
  batchSize?: number;
}

export interface LookupResponse {
  data?: {
    items: LookupItem[];
  };
  items?: LookupItem[];
}

export interface LookupItem {
  found?: boolean;
  variants: LookupVariant[];
}

export interface LookupVariant {
  url: string;
  width: number;
  height?: number;
}
