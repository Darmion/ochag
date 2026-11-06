export const permissions = ['scenes.manage','characters.manage','notes.manage','vision.manage','rules.manage'];
export const obj = (properties: object, required: string[] = Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
export const uuid = {type:'string',format:'uuid'};
export const bool = {type:'boolean'};
export const shortText = (maxLength: number) => ({type:'string',minLength:1,maxLength,pattern:/\S/.source});
export const loginFields = {username:{type:'string',minLength:1,maxLength:64,pattern:/\S/.source},password:{type:'string',minLength:1,maxLength:200}};
export const normalizeLogin = (username: string) => username.trim().toLowerCase();
export type CampaignParams = {campaignId:string};
