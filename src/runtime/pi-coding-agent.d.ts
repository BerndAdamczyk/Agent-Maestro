declare module "@mariozechner/pi-coding-agent" {
  export type ExtensionAPI = any;
  export type BashToolInput = any;
  export type EditToolInput = any;
  export type ReadToolInput = any;
  export type WriteToolInput = any;

  export function createBashTool(...args: any[]): any;
  export function createEditTool(...args: any[]): any;
  export function createReadTool(...args: any[]): any;
  export function createWriteTool(...args: any[]): any;
  export function isToolCallEventType<TName extends string, TInput>(name: TName, event: any): boolean;
}
