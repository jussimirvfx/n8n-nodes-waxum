export type ApiChannel = 'web' | 'cloud';
export type CatalogField = {
  name: string;
  label?: string;
  type: 'text' | 'textarea' | 'number' | 'checkbox' | 'json' | 'select' | 'file';
  required?: boolean;
  placeholder?: string;
  default?: string | number | boolean;
  options?: string[];
  in_path?: boolean;
  in_query?: boolean;
};
export type CatalogAction = {
  id: string;
  group: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  fields: CatalogField[];
  channel?: ApiChannel;
  confirm: boolean;
  rawBody?: string;
  download: boolean;
};
