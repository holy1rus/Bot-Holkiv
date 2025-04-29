const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN, ADMIN_ID } = require('./config');
const db = require('./database');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(BOT_TOKEN);

// Создаем директории для хранения чеков
const proofDir = path.join(__dirname, 'payments', 'proofs');
const confirmedDir = path.join(__dirname, 'payments', 'confirmed');
const rejectedDir = path.join(__dirname, 'payments', 'rejected');

[proofDir, confirmedDir, rejectedDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Приветствие
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  await db.addUser(userId, username);
  
  const keyboard = Markup.keyboard([
    ['👤 Профиль', '💰 Пополнить баланс'],
    ['🎮 Заказать донат', '📜 История заказов'],
    ['⭐ Оставить отзыв', '📋 Правила']
  ]).resize();

  ctx.reply(
    `✨ Добро пожаловать в 🥝 𝙱𝚘𝚝 𝙷𝚘𝚕𝚔𝚒𝚟 🥝\n\n` +
    `Твой проводник в мире игровых сокровищ!\n\n` +
    `📋 Правила использования:\n` +
    `1. Минимальная сумма пополнения: 50₽\n` +
    `2. Максимальная сумма в день: 15000₽\n` +
    `3. Все платежи проверяются вручную\n` +
    `4. При оплате прикладывайте чек`,
    keyboard
  );
});

// Профиль
bot.hears('👤 Профиль', async (ctx) => {
  const user = await db.getUser(ctx.from.id);
  if (!user) {
    ctx.reply('Произошла ошибка при получении данных профиля');
    return;
  }

  const rankInfo = db.getRankInfo(user.total_spent);
  const progressBar = db.getProgressBar(user.total_spent, rankInfo.required + user.total_spent);

  const profileText = 
    `${rankInfo.icon} <b>[${rankInfo.name}]</b>\n` +
    `👤 <b>Ваш профиль</b>:\n` +
    `├ ID: <code>${user.user_id}</code>\n` +
    `├ Баланс: <b>${user.balance}₽</b>\n` +
    `├ Заказов: <b>${user.orders_count}</b>\n` +
    `├ Всего потрачено: <b>${user.total_spent}₽</b>\n` +
    `└ Прогресс: [${progressBar}] ${Math.min(Math.floor((user.total_spent / (rankInfo.required + user.total_spent)) * 100), 100)}%\n\n`;

  const nextRankText = rankInfo.nextRank 
    ? `До ${rankInfo.nextRank} ранга: <b>${rankInfo.required}₽</b>`
    : 'Вы достигли максимального ранга! 🎉';

  ctx.reply(
    profileText + nextRankText,
    { parse_mode: 'HTML' }
  );
});

// История заказов
bot.hears('📜 История заказов', async (ctx) => {
  const orders = await db.getOrderHistory(ctx.from.id);
  if (!orders || orders.length === 0) {
    ctx.reply('У вас пока нет заказов');
    return;
  }

  let historyText = '📜 <b>Последние заказы</b>:\n\n';
  orders.forEach((order, index) => {
    const date = new Date(order.created_at).toLocaleString('ru-RU');
    historyText += 
      `#${index + 1} ${date}\n` +
      `├ Сумма: ${order.amount}₽\n` +
      `├ Игра: ${order.game || 'Не указана'}\n` +
      `└ Статус: ${getStatusEmoji(order.status)} ${order.status}\n\n`;
  });

  ctx.reply(historyText, { parse_mode: 'HTML' });
});

// Пополнение баланса
bot.hears('💰 Пополнить баланс', (ctx) => {
  ctx.reply(
    'Введите сумму пополнения (от 50₽ до 15000₽):',
    Markup.keyboard([['Отмена']]).resize()
  );
});

// Обработка суммы пополнения
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text === 'Отмена') {
    ctx.reply(
      'Операция отменена',
      Markup.keyboard([
        ['👤 Профиль', '💰 Пополнить баланс'],
        ['🎮 Заказать донат', '📜 История заказов'],
        ['⭐ Оставить отзыв', '📋 Правила']
      ]).resize()
    );
    return;
  }

  const amount = parseInt(text);
  if (isNaN(amount) || amount < 50 || amount > 15000) {
    ctx.reply('Пожалуйста, введите корректную сумму (от 50₽ до 15000₽)');
    return;
  }

  const paymentId = `pay_${Date.now()}_${ctx.from.id}`;
  await db.createPayment(ctx.from.id, amount, paymentId);

  const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${process.env.YOOMONEY_WALLET}&sum=${amount}&label=${paymentId}`;

  ctx.reply(
    `⚠ Оплатите в течение 5 минут!\n\n` +
    `Сумма: ${amount}₽\n` +
    `ID платежа: ${paymentId}\n\n` +
    `[Оплатить](${paymentUrl})`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        Markup.button.url('💳 Оплатить', paymentUrl),
        Markup.button.callback('❌ Отмена', 'cancel_payment')
      ])
    }
  );

  // Таймер на 5 минут
  setTimeout(async () => {
    const payment = await db.getPayment(paymentId);
    if (payment && payment.status === 'pending') {
      ctx.reply(
        `⏳ В течение 5 минут не поступили средства.\n` +
        `Если вы оплатили, приложите скриншот чека (должны быть видны дата, сумма и получатель).`,
        Markup.keyboard([
          ['📎 Приложить чек'],
          ['Отмена']
        ]).resize()
      );
    }
  }, 5 * 60 * 1000);
});

// Обработка фото чека
bot.on('photo', async (ctx) => {
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const file = await ctx.telegram.getFile(fileId);
  const paymentId = await db.getLastUnpaidPayment(ctx.from.id);

  if (!paymentId) {
    ctx.reply('У вас нет ожидающих оплат');
    return;
  }

  const filePath = path.join(proofDir, `${paymentId}.jpg`);
  await ctx.telegram.downloadFile(file.file_path, filePath);

  await db.updatePaymentStatus(paymentId, 'needs_review', filePath);

  // Уведомление админу
  await ctx.telegram.sendPhoto(
    ADMIN_ID,
    fileId,
    {
      caption: `🚨 Требуется проверка чека!\n` +
               `Платеж: ${paymentId}\n` +
               `Пользователь: @${ctx.from.username} (ID: ${ctx.from.id})`,
      reply_markup: Markup.inlineKeyboard([
        Markup.button.callback('✅ Подтвердить', `confirm_${paymentId}`),
        Markup.button.callback('❌ Отклонить', `reject_${paymentId}`)
      ])
    }
  );

  ctx.reply(
    'Чек передан на проверку. Ожидайте подтверждения.',
    Markup.keyboard([
      ['👤 Профиль', '💰 Пополнить баланс'],
      ['🎮 Заказать донат', '📜 История заказов'],
      ['⭐ Оставить отзыв', '📋 Правила']
    ]).resize()
  );
});

// Обработка callback-запросов
bot.action(/confirm_(.+)/, async (ctx) => {
  const paymentId = ctx.match[1];
  const payment = await db.getPayment(paymentId);

  if (payment) {
    await db.updatePaymentStatus(paymentId, 'confirmed');
    await db.updateBalance(payment.user_id, payment.amount, `Пополнение баланса на ${payment.amount}₽`);

    // Перемещаем чек в confirmed
    const oldPath = path.join(proofDir, `${paymentId}.jpg`);
    const newPath = path.join(confirmedDir, `${paymentId}.jpg`);
    fs.renameSync(oldPath, newPath);

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
      payment.user_id,
      `✅ Ваш платёж подтверждён! На баланс зачислено ${payment.amount}₽.`
    );

    ctx.answerCbQuery('Платеж подтвержден');
    ctx.editMessageCaption('✅ Платеж подтвержден');
  }
});

bot.action(/reject_(.+)/, async (ctx) => {
  const paymentId = ctx.match[1];
  const payment = await db.getPayment(paymentId);

  if (payment) {
    await db.updatePaymentStatus(paymentId, 'rejected');

    // Перемещаем чек в rejected
    const oldPath = path.join(proofDir, `${paymentId}.jpg`);
    const newPath = path.join(rejectedDir, `${paymentId}.jpg`);
    fs.renameSync(oldPath, newPath);

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
      payment.user_id,
      `❌ После проверки чека платеж не найден. Повторите оплату.`
    );

    ctx.answerCbQuery('Платеж отклонен');
    ctx.editMessageCaption('❌ Платеж отклонен');
  }
});

// Ежедневная статистика для админа
setInterval(async () => {
  const stats = await db.getDailyStats();
  const date = new Date().toLocaleDateString('ru-RU');
  
  await bot.telegram.sendMessage(
    ADMIN_ID,
    `💰 Статистика за ${date}:\n\n` +
    `Заказов: ${stats.orders_count}\n` +
    `Выручка: ${stats.total_revenue || 0}₽\n` +
    `Уникальных пользователей: ${stats.unique_users}`
  );
}, 24 * 60 * 60 * 1000);

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
});

// Запуск бота
bot.launch()
  .then(() => console.log('Бот успешно запущен!'))
  .catch(err => console.error('Ошибка при запуске бота:', err));

// Обработка завершения работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Вспомогательные функции
function getStatusEmoji(status) {
  switch (status) {
    case 'completed': return '✅';
    case 'pending': return '⏳';
    case 'cancelled': return '❌';
    default: return '❓';
  }
} 