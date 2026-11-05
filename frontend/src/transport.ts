export class ApiError extends Error {
  constructor(
    public kind:
      "network" | "authorization" | "gateway" | "server" | "protocol",
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function decodeApiResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    if (response.status === 401)
      throw new ApiError(
        "authorization",
        "Сессия Telegram недействительна или истекла. Переоткройте приложение через бота. Черновик остаётся на устройстве.",
        401,
      );
    if (!(e instanceof SyntaxError))
      throw new ApiError(
        "network",
        "Соединение прервалось при чтении ответа. Черновик остаётся на устройстве.",
        response.status,
      );
    if (response.status === 429)
      throw new ApiError(
        "server",
        "Слишком много запросов. Подождите и повторите.",
        429,
      );
    throw new ApiError(
      "gateway",
      "Публичный адрес вернул страницу вместо API. Проверьте HTTPS endpoint и APP_URL; это не отказ в геолокации.",
      response.status,
    );
  }
  if (!response.ok) {
    const error =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error.slice(0, 600)
        : undefined;
    if (response.status === 401)
      throw new ApiError(
        "authorization",
        error ?? "Переоткройте приложение через Telegram для авторизации.",
        401,
      );
    throw new ApiError(
      response.status >= 502 ? "gateway" : "server",
      error ??
        `Ошибка ${response.status}. Проверьте публичный endpoint и состояние сервера.`,
      response.status,
    );
  }
  if (!body || typeof body !== "object")
    throw new ApiError(
      "protocol",
      "Сервер вернул неожиданный формат данных.",
      response.status,
    );
  return body as T;
}
