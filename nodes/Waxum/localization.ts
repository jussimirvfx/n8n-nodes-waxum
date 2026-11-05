import type { INodeProperties, INodePropertyOptions, INodeType } from 'n8n-workflow';
import { catalogPortuguese, operationPortuguese } from './catalog.pt';
import { interfacePortuguese } from './interface.pt';

export const languageParameter = 'interfaceLanguage';
export const portuguese = 'pt-BR';

const languageSelector: INodeProperties = {
  displayName: 'Language / Idioma',
  name: languageParameter,
  type: 'options',
  options: [
    {name: 'English', value: 'en'},
    {name: 'Português (Brasil)', value: portuguese},
  ],
  default: 'en',
  noDataExpression: true,
};

function translate(text: string): string {
  if (Object.hasOwn(interfacePortuguese, text)) return interfacePortuguese[text];
  if (Object.hasOwn(catalogPortuguese, text)) return catalogPortuguese[text];
  return text;
}

function translateProperty(property: INodeProperties): INodeProperties {
  return {
    ...property,
    displayName: translate(property.displayName),
    ...(property.description ? {description: translate(property.description)} : {}),
    ...(property.placeholder ? {placeholder: translate(property.placeholder)} : {}),
    ...(property.hint ? {hint: translate(property.hint)} : {}),
    ...(property.options ? {options: property.options.map(option => {
      if ('values' in option) {
        return {...option, displayName: translate(option.displayName), values: option.values.map(translateProperty)};
      }
      if ('displayName' in option) return translateProperty(option);
      const operation = property.name === 'operation' ? String(option.value) : '';
      const actionLabel = Object.hasOwn(operationPortuguese, operation) ? operationPortuguese[operation] : undefined;
      return {
        ...option,
        name: actionLabel ?? translate(option.name),
        ...(option.action ? {action: actionLabel ?? translate(option.action)} : {}),
        ...(option.description ? {description: translate(option.description)} : {}),
      };
    })} : {}),
    ...(property.modes ? {modes: property.modes.map(mode => ({
      ...mode,
      displayName: translate(mode.displayName),
      ...(mode.placeholder ? {placeholder: translate(mode.placeholder)} : {}),
      ...(mode.hint ? {hint: translate(mode.hint)} : {}),
    }))} : {}),
  };
}

export function addLanguageSelector(node: INodeType): INodeType {
  const properties = node.description.properties.flatMap(property => {
    if (property.type === 'hidden') return [property];
    const definition = property.type === 'resourceLocator'
      ? {...property, typeOptions: {...property.typeOptions,
        loadOptionsDependsOn: [...(property.typeOptions?.loadOptionsDependsOn ?? []), languageParameter]}}
      : property;
    // n8n clears dependent option values when a parameter changes. A root
    // reference keeps that cleanup from treating a collection as a select.
    const languageCondition = property.type === 'collection' ? '/' + languageParameter : languageParameter;
    const english = {...definition, displayOptions: {...definition.displayOptions,
      hide: {...definition.displayOptions?.hide, [languageCondition]: [portuguese]}}};
    const localized = {...translateProperty(definition), displayOptions: {...definition.displayOptions,
      show: {...definition.displayOptions?.show, [languageCondition]: [portuguese]}}};

    if (property.name === 'resource') {
      const categories = (property.options ?? []).filter((option): option is INodePropertyOptions => 'value' in option);
      node.methods = {...node.methods, loadOptions: {...node.methods?.loadOptions,
        async listPortugueseCategories() {
          return categories.map(option => {
            const separator = option.name.indexOf(' · ');
            const prefix = option.name.slice(0, separator + 3);
            return {...option, name: prefix + translate(option.name.slice(separator + 3))};
          });
        },
      }};
      // The add-node sidebar indexes only the static English resource options.
      delete localized.options;
      localized.typeOptions = {...localized.typeOptions, loadOptionsMethod: 'listPortugueseCategories'};
    }
    return [english, localized];
  });
  node.description = {...node.description, properties: [languageSelector, ...properties]};
  return node;
}
