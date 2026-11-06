export const INGREDIENTS = [
  { name: 'Уголь саламандры', glyph: '♨', heat: 2, essence: 1, stability: -1 },
  { name: 'Лунная роса', glyph: '☽', heat: -1, essence: 1, stability: 1 },
  { name: 'Корень мандрагоры', glyph: '❧', heat: 0, essence: 2, stability: 0 },
  { name: 'Звёздная пыль', glyph: '✦', heat: 1, essence: 2, stability: -2 },
] as const;
export const RECIPES = [
  { name: 'Согревающий эликсир', heat: [4, 5], essence: 5, stability: 2, description: 'Янтарная смесь с мягким внутренним свечением.' },
  { name: 'Лунный настой', heat: [0, 1], essence: 4, stability: 4, description: 'Серебристый настой, прохладный даже возле огня.' },
  { name: 'Звёздные чернила', heat: [3, 4], essence: 6, stability: 1, description: 'Чернила, в которых мерцают крошечные созвездия.' },
] as const;
export type Alchemy = { revision: number; phase: 'brewing' | 'perfect' | 'flawed' | 'burned' | 'cancelled'; recipe: number; heat: number; essence: number; stability: number; stock: number[]; moves: number; limit: number; message: string; history: string[] };
export type AlchemyCommand = { action: 'add'; ingredient: number } | { action: 'heat' } | { action: 'cool' } | { action: 'stir' } | { action: 'bottle' } | { action: 'cancel' };
export function createAlchemy(revision: number, recipe: number, limit: number): Alchemy {
  if (!Number.isInteger(recipe) || !RECIPES[recipe]) throw new Error('Рецепт не найден.');
  if (!Number.isInteger(limit) || limit < 4 || limit > 16) throw new Error('Выберите от 4 до 16 действий.');
  return { revision, phase: 'brewing', recipe, heat: 2, essence: 0, stability: 3, stock: [2, 2, 2, 2], moves: 0, limit, message: 'Котёл готов. Согласуйте рецепт перед добавлением ингредиентов.', history: [] };
}
export function alchemyReady(game: Alchemy): boolean {
  const recipe = RECIPES[game.recipe];
  return game.heat >= recipe.heat[0] && game.heat <= recipe.heat[1] && game.essence === recipe.essence && game.stability >= recipe.stability;
}
export function actAlchemy(current: Alchemy, command: AlchemyCommand, user: { name: string; manager: boolean }): Alchemy {
  if (current.phase !== 'brewing') throw new Error('Приготовление завершено.');
  const game = structuredClone(current);
  if (command.action === 'cancel') {
    if (!user.manager) throw new Error('Завершить приготовление может только мастер.');
    game.phase = 'cancelled'; game.message = 'Мастер завершил приготовление.';
  } else if (command.action === 'bottle') {
    if (!game.essence) throw new Error('Сначала добавьте хотя бы один ингредиент.');
    game.phase = alchemyReady(game) ? 'perfect' : 'flawed';
    game.message = game.phase === 'perfect' ? `${user.name}: рецепт соблюдён — зелье «${RECIPES[game.recipe].name}» готово!` : `${user.name}: смесь разлита с отклонениями. Побочный эффект: светящийся осадок и резкий запах. Последствия определяет мастер.`;
  } else {
    if (game.moves >= game.limit) throw new Error('Действия закончились. Можно только разлить смесь или завершить приготовление.');
    if (command.action === 'add') {
      if (!Number.isInteger(command.ingredient) || !INGREDIENTS[command.ingredient]) throw new Error('Ингредиент не найден.');
      if (!game.stock[command.ingredient]) throw new Error('Этот ингредиент закончился.');
      const ingredient = INGREDIENTS[command.ingredient];
      game.stock[command.ingredient]--; game.heat = Math.max(0, game.heat + ingredient.heat);
      game.essence += ingredient.essence; game.stability = Math.min(6, game.stability + ingredient.stability);
      game.message = `${user.name}: добавлен ингредиент «${ingredient.name}».`;
    } else if (command.action === 'heat') {
      game.heat++; game.message = `${user.name}: жар повышен на 1.`;
    } else if (command.action === 'cool') {
      if (game.heat === 0) throw new Error('Смесь уже холодная.');
      game.heat--; game.message = `${user.name}: жар снижен на 1.`;
    } else {
      if (game.stability === 6) throw new Error('Смесь уже полностью устойчива.');
      game.stability++; game.message = `${user.name}: смесь перемешана, устойчивость +1.`;
    }
    game.moves++;
    if (game.heat > 6 || game.stability < 0) { game.phase = 'burned'; game.message += ' Смесь вспенилась и испорчена!'; }
    else if (game.moves === game.limit) game.message += ' Действия закончились: разлейте полученную смесь.';
  }
  game.revision++; game.history.push(game.message);
  return game;
}
