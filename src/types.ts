export interface CategoryOption {
  key: string
  label: string
  type: 'number' | 'string' | 'boolean' | 'tri-boolean' | 'choice'
  choices?: string[]
  default: number | string | boolean | undefined
}

export interface Category {
  key: string
  name: string
  options: CategoryOption[]
}

export interface ResolvedOptions {
  [key: string]: string | number | boolean | undefined
}

export interface PluginScaffold {
  pluginName: string
  routeNames: string[]
  hookNames: string[]
  hasDecorator: boolean
  childPluginName: string | undefined
  additions: string[]
}

export interface GeneratedFile {
  relativePath: string
  content: string
}
