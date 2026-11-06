"""assets/sorted/<path>.png -> apps/client/public/art/<path>.webp (lossless, 64 px; portraits and scene 128 px)
and the picker catalog apps/client/src/art/artLibrary.json. AI-made pictures (sources codex-made/ and output/) go to the
optional art pack mods/ai-art (art/ and library.json, keeping the names NPC portraits are matched by).
Fails when itemArt.ts or portraitArt.ts names a missing picture.
Needs Pillow (python -m pip install pillow). Run from the root: python scripts/build-art.py"""
import json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'assets', 'sorted')
TARGET = os.path.join(ROOT, 'apps', 'client', 'public', 'art')
CODE = [os.path.join(ROOT, 'apps', 'client', 'src', 'art', name) for name in ('itemArt.ts', 'portraitArt.ts')]
LIBRARY = os.path.join(ROOT, 'apps', 'client', 'src', 'art', 'artLibrary.json')
PACK = os.path.join(ROOT, 'mods', 'ai-art')
PACK_TARGET = os.path.join(PACK, 'art')
PACK_LIBRARY = os.path.join(PACK, 'library.json')
PACK_SOURCES = ('codex-made/', 'output/')
SIZE = 64
LARGE = ('portraits/', 'scene/')
LARGE_SIZE = 128

GROUPS = [
    ('items/weapons/swords', 'Оружие · Мечи'),
    ('items/weapons/daggers', 'Оружие · Кинжалы и ножи'),
    ('items/weapons/axes', 'Оружие · Топоры и секиры'),
    ('items/weapons/polearms', 'Оружие · Копья и древковое'),
    ('items/weapons/scythes', 'Оружие · Косы и серпы'),
    ('items/weapons/clubs', 'Оружие · Дубины, булавы, молоты'),
    ('items/weapons/staves', 'Оружие · Посохи'),
    ('items/weapons/thrown', 'Оружие · Метательное'),
    ('items/weapons/bows', 'Оружие · Луки'),
    ('items/weapons/crossbows', 'Оружие · Арбалеты'),
    ('items/weapons/firearms', 'Оружие · Огнестрельное'),
    ('items/weapons/misc', 'Оружие · Кнут, праща, сеть'),
    ('items/ammo/arrows', 'Боеприпасы · Стрелы и болты'),
    ('items/ammo/quivers', 'Боеприпасы · Колчаны'),
    ('items/ammo', 'Боеприпасы · Наконечники'),
    ('items/armor', 'Доспехи · Доспехи и щиты'),
    ('items/potions', 'Вещи · Зелья и склянки'),
    ('items/food', 'Вещи · Еда'),
    ('items/valuables', 'Вещи · Монеты и драгоценности'),
    ('items/documents', 'Вещи · Книги, свитки, письма'),
    ('items/keys', 'Вещи · Ключи'),
    ('items/gear', 'Вещи · Снаряжение'),
    ('items/tools', 'Вещи · Инструменты и наборы'),
    ('items/clothing', 'Вещи · Одежда'),
    ('items/magic/arcane', 'Магия · Тайное'),
    ('items/magic/fire', 'Магия · Огонь'),
    ('items/magic/cold', 'Магия · Холод'),
    ('items/magic/storm', 'Магия · Гроза и ветер'),
    ('items/magic/nature', 'Магия · Природа'),
    ('items/magic/death', 'Магия · Смерть'),
    ('items/magic/light', 'Магия · Свет'),
    ('items/magic/shadow', 'Магия · Тьма'),
    ('items/magic/wands', 'Магия · Палочки'),
    ('items/magic/scepters', 'Магия · Скипетры'),
    ('items/magic/worn', 'Магия · Кольца, амулеты, плащи'),
    ('scene/containers/chests', 'Сцена · Сундуки'),
    ('scene/containers', 'Сцена · Бочки, ящики, вазы'),
    ('scene/props', 'Сцена · Обстановка'),
    ('scene/traps', 'Сцена · Ловушки'),
    ('scene/nature/trees-conifer', 'Природа · Хвойные деревья'),
    ('scene/nature/trees-leafy', 'Природа · Лиственные деревья'),
    ('scene/nature/trees-dead', 'Природа · Мёртвые деревья'),
    ('scene/nature/bushes', 'Природа · Кусты'),
    ('scene/nature/grass', 'Природа · Трава и цветы'),
    ('scene/nature/mushrooms', 'Природа · Грибы'),
    ('scene/nature/rocks', 'Природа · Камни и кристаллы'),
    ('scene/nature/wood', 'Природа · Брёвна и пни'),
    ('scene/nature/exotic', 'Природа · Юг и экзотика'),
    ('ui/symbols', 'Интерфейс · Символы'),
    ('ui/frames', 'Интерфейс · Рамки и ячейки'),
    ('ui/cursors', 'Интерфейс · Курсоры'),
    ('ui/classes', 'Интерфейс · Гербы классов'),
    ('ui/races', 'Интерфейс · Знаки рас'),
    ('portraits/heroes', 'Портреты · Герои'),
    ('portraits/npc', 'Портреты · Горожане'),
    ('portraits/bestiary', 'Портреты · Бестиарий'),
]

catalog = json.load(open(os.path.join(SOURCE, 'catalog.json'), encoding='utf-8'))['entries']
pictures = [entry for entry in catalog if entry['file'].endswith('.png') and entry['file'].split('/')[0] in ('items', 'scene', 'ui', 'portraits')]
labels = {group: label for group, label in GROUPS}
unknown = sorted({os.path.dirname(entry['file']) for entry in pictures} - set(labels))
if unknown:
    sys.exit('Раздела нет в GROUPS: ' + ', '.join(unknown))

paths = {entry['file'][:-4] for entry in pictures}
wanted_by_code = set()
for code in CODE:
    wanted_by_code |= set(re.findall(r"'((?:items|scene|ui|portraits)/[a-z0-9/-]+)'", open(code, encoding='utf-8').read()))
missing = sorted(wanted_by_code - paths)
if missing:
    sys.exit('itemArt.ts / portraitArt.ts ссылаются на то, чего нет в assets/sorted: ' + ', '.join(missing))

in_pack = lambda entry: entry.get('source', '').startswith(PACK_SOURCES)
names = {}
if os.path.exists(PACK_LIBRARY):
    for group in json.load(open(PACK_LIBRARY, encoding='utf-8'))['groups']:
        for item in group['items']:
            if item.get('names'):
                names[item['path']] = item['names']

written = set()
total = 0
for entry in pictures:
    path = entry['file'][:-4]
    size = LARGE_SIZE if entry['file'].startswith(LARGE) else SIZE
    image = Image.open(os.path.join(SOURCE, entry['file'])).convert('RGBA').resize((size, size), Image.BOX)
    out = os.path.join(PACK_TARGET if in_pack(entry) else TARGET, path + '.webp')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    image.save(out, 'WEBP', lossless=True, method=6)
    written.add(os.path.normpath(out))
    total += os.path.getsize(out)
for target in (TARGET, PACK_TARGET):
    for folder, _, files in os.walk(target):
        for name in files:
            full = os.path.normpath(os.path.join(folder, name))
            if full not in written:
                os.remove(full)

def write_library(file_name, chosen):
    library = []
    for group, label in GROUPS:
        items = []
        for entry in pictures:
            if os.path.dirname(entry['file']) != group or not chosen(entry):
                continue
            item = {'path': entry['file'][:-4], 'label': entry['label']}
            if item['path'] in names:
                item['names'] = names[item['path']]
            items.append(item)
        if items:
            section, _, sub = label.partition(' · ')
            library.append({'id': group, 'label': label, 'section': section, 'items': items})
    with open(file_name, 'w', encoding='utf-8', newline='\n') as file:
        json.dump({'groups': library}, file, ensure_ascii=False, indent=1)
        file.write('\n')

write_library(LIBRARY, lambda entry: not in_pack(entry))
write_library(PACK_LIBRARY, in_pack)
print(f'{len(pictures)} картинок, {total // 1024} КБ → apps/client/public/art и mods/ai-art/art; каталоги — artLibrary.json и mods/ai-art/library.json')
