# Сайт Next Page

Сайт и форма работают на Node.js. Нужен Node.js 20 или новее.

## Настройка отправки заявок через Gmail

Заявки будут приходить на `nextpage@inboxbear.com`. Сайт отправляет их через Gmail по SMTP.

1. Скопируйте `.env.example` в `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Включите двухэтапную аутентификацию Google и создайте пароль приложения на странице [Пароли приложений Google](https://myaccount.google.com/apppasswords). Обычный пароль Google для SMTP не подходит.
3. В `.env` укажите полный адрес Gmail в `SMTP_USER` и `MAIL_FROM`, а пароль приложения без пробелов — в `SMTP_PASSWORD`. `SMTP_HOST`, порт 587 и `SMTP_SECURE=false` уже заданы. `MAIL_TO` настроен на `nextpage@inboxbear.com`.
4. Установите зависимости один раз:

   ```powershell
   npm install
   ```

5. Запустите сайт:

   ```powershell
   npm start
   ```

6. Откройте `http://localhost:3000`. Форма отправит заявку на указанный email.

Не публикуйте `.env` и не добавляйте его в систему контроля версий. Если в аккаунте недоступны пароли приложений, Gmail не позволит этому сайту войти по SMTP. Для публичного запуска задайте те же переменные окружения на Node.js-хостинге и включите HTTPS.
