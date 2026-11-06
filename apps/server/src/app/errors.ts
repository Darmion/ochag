export class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
}
export const fail = (status: number, message: string): never => {throw new ApiError(status,message);};
const FIELD_LABELS: Record<string,string> = {username:'Логин',password:'Пароль',displayName:'Имя в игре',name:'Название',code:'Код приглашения'};
export function describeValidation(validation: unknown): {message:string;field?:string} {
  const first = (Array.isArray(validation) ? validation[0] : undefined) as {keyword?:string;instancePath?:string;params?:Record<string,any>} | undefined;
  const field = first?.params?.missingProperty ?? first?.instancePath?.split('/').filter(Boolean).pop();
  const label = field ? FIELD_LABELS[field] ?? `«${field}»` : 'Поле';
  switch (first?.keyword) {
    case 'required': return {field,message:`${label}: заполните поле.`};
    case 'pattern': if (field === 'code') return {field,message:'Код приглашения неполный или с лишними символами — скопируйте его целиком.'};
    // falls through
    case 'minLength': return {field,message:`${label}: заполните поле.`};
    case 'maxLength': return {field,message:`${label}: не длиннее ${first.params?.limit} символов.`};
    case 'additionalProperties': return {field:first.params?.additionalProperty,message:`Лишнее поле в запросе: «${first.params?.additionalProperty}». Обновите приложение до версии сервера.`};
    case 'format': case 'type': case 'enum': return {field,message:`${label}: недопустимое значение.`};
    default: return {field,message:'Проверьте поля запроса.'};
  }
}
