export const ELITE_DESCRIPTORS: string[] = [
  'Mauler','Butcher','Scourge','Bane','Stalker','Crusher','Gnawer','Ravager','Reaper','Gouger',
  'Ruiner','Wrecker','Sunderer','Bleeder','Severer','Ripper','Gnasher','Pummeler','Bludgeon','Impaler',
  'Harrier','Howler','Shrieker','Gloom','Horror','Torment','Rancor','Grinder','Gutter','Scalper',
  'Flayer','Breaker','Brute','Brawler','Gorelord','Mangler','Maw','Skulker','Prowler','Creeper',
  'Haunt','Biter','Maimer','Slicer','Sunder','Crippler','Glaive','Charger','Culler','Ruinborn'
];

export const ELITE_CITIES: string[] = [
  'Tulsa','Phoenix','London','Prague','Berlin','Oslo','Dublin','Vienna','Zurich','Geneva',
  'Warsaw','Brno','Budapest','Lisbon','Porto','Madrid','Seville','Milan','Naples','Turin',
  'Munich','Hamburg','Bremen','Cologne','Ghent','Bruges','Antwerp','Rotterdam','Utrecht','Helsinki',
  'Stockholm','Gothenburg','Copenhagen','Reykjavik','Tallinn','Riga','Vilnius','Krakow','Gdansk','Lviv',
  'Kyiv','Odessa','Bucharest','Cluj','Sofia','Belgrade','Zagreb','Athens','Thessaloniki','Skopje'
];

export const BOSS_FIRSTNAMES: string[] = [
  'Terry','Jon','Laura','Todd','Mara','Clint','Ada','Victor','Ivy','Grant',
  'Rhea',' Felix','Dana','Carla','Bruce','Ethan','Noah','Amara','Iris','Gwen',
  'Jude','Seth','Harper','Piper','Logan','Kai','Mila','Nova','Owen','Tessa',
  'Aria','Zane','Lena','Quinn','Rory','Sloane','Bryn','Hale','Kira','Nash',
  'Vera','Wade','Xena','Yara','Zara','Caleb','Dina','Emil','Faye','Holt'
];

export const BOSS_ADJECTIVES: string[] = [
  'heated','terrible','angry','fierce','maniacal','furious','ruthless','vicious','grim','diabolic',
  'relentless','merciless','savage','dire','feral','brutal','spiteful','wicked','rabid','malevolent',
  'seething','baleful','venomous','ghastly','hellish','volcanic','tempestuous','storming','unyielding','ironclad',
  'berserk','fanatical','grimacing','howling','raging','thundering','cruel','hateful','wrathful','bloodthirsty',
  'fearsome','wild','unyielding','unyielded','horrid','ominous','grimdark','ashen','blighted','toxic'
];

export const BOSS_LABELS: string[] = [
  'shredder','destroyer','deranged','life ender','colony destroyer','annihilator','ravager','desolator','harrower','obliterator',
  'ruinbringer','devastator','immolator','crusher','breaker','butcher','gorelord','soulreaper','doomcaller','stormbringer',
  'ironfist','bonesnapper','shadowmonger','nightstalker','voidwalker','plaguebearer','blightbringer','hellraiser','earthshaker','skullsplitter',
  'warlord','reaver','headhunter','fleshrender','bane','scourge','wrathbinder','bloodletter','grimward','silentscourge',
  'sundering hand','ashen maw','grave maker','soul breaker','fear monger','pain dealer','horde master','mind flayer','storm cleaver','world eater'
];

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

export const generateEliteName = (): string => {
  return `${pick(ELITE_DESCRIPTORS)} of ${pick(ELITE_CITIES)}`;
};

export const generateBossName = (): string => {
  return `${pick(BOSS_FIRSTNAMES)} the ${pick(BOSS_ADJECTIVES)} ${pick(BOSS_LABELS)}`;
};

