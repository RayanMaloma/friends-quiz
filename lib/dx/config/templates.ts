/**
 * BUILT-IN TEMPLATES
 * ------------------------------------------------------------------
 * The names below ("ليبرالي", "فاشي", "الرئيس" …) are just editable
 * *data*. The engine never references them; it only sees IDs, faction
 * links and rule definitions. Every value can be changed in the admin
 * dashboard.
 */
import type { CardDef, DistributionRow, Faction, GameConfig, Role, Rule, Track } from '../types/config';
import { SAMPLE_THEMES } from './themes';
import { deepClone } from './ids';
import { defaultBoard, face, makeCard, profile, spaces } from './defaults';

/* ================================================================== */
/* CLASSIC TEMPLATE                                                    */
/* ================================================================== */

export function classicTemplate(): GameConfig {
  const factions: Faction[] = [
    { id: 'fac_lib', name: 'الليبراليون', color: '#2f6f9f', icon: 'dove', emblem: {}, membershipLabel: 'ليبرالي', description: 'هم الأغلبية، بس ما يعرفون مين معهم. يفوزون إذا اعتمدوا ٥ قوانين ليبرالية أو أعدموا هتلر.' },
    { id: 'fac_fas', name: 'الفاشيون', color: '#b5361f', icon: 'skull', emblem: {}, membershipLabel: 'فاشي', description: 'أقلية سرّية يعرفون بعض. يفوزون إذا اعتمدوا ٦ قوانين فاشية، أو انتُخب هتلر مستشارًا بعد ٣ قوانين فاشية.' },
  ];

  const roles: Role[] = [
    {
      id: 'role_lib', name: 'ليبرالي', factionId: 'fac_lib', portrait: {}, icon: 'dove',
      description: 'عضو مخلص في الحزب الليبرالي.',
      secretInfo: 'ما تعرف أحد. انتبه لمين تثق فيه.',
      abilities: 'ما عندك صلاحيات — صوتك وكلامك هم سلاحك.',
      winCondition: 'اعتماد ٥ قوانين ليبرالية، أو إعدام هتلر.',
      loseCondition: 'يكمّل الفاشيون مسارهم أو يُنتخب هتلر في الوقت الغلط.',
      knowledge: [], canBeLeader: true, canBeNominee: true, canBeTargeted: true, cardId: 'card_role_lib',
    },
    {
      id: 'role_fas', name: 'فاشي', factionId: 'fac_fas', portrait: {}, icon: 'skull',
      description: 'عضو سرّي في الحزب الفاشي.',
      secretInfo: 'تعرف باقي الفاشيين وتعرف هتلر. احمِ هتلر وازرع الشك.',
      abilities: 'يعرف باقي أعضاء فريقه.',
      winCondition: '٦ قوانين فاشية، أو انتخاب هتلر مستشارًا بعد ٣ قوانين فاشية.',
      loseCondition: 'إعدام هتلر أو يكمّل الليبراليون مسارهم.',
      knowledge: [{ id: 'k1', seesRoleIds: ['role_fas', 'role_hitler'] }],
      canBeLeader: true, canBeNominee: true, canBeTargeted: true, cardId: 'card_role_fas',
    },
    {
      id: 'role_hitler', name: 'هتلر', factionId: 'fac_fas', portrait: {}, icon: 'crown',
      description: 'القائد السرّي للفاشيين.',
      secretInfo: 'خلك مخفي. مع ٥–٦ لاعبين تعرف مين الفاشي؛ في الألعاب الأكبر ما تعرف أحد.',
      abilities: 'يفوز فريقه فورًا إذا انتُخب مستشارًا بعد ٣ قوانين فاشية.',
      winCondition: 'تنتخب مستشارًا بعد ٣ قوانين فاشية، أو ٦ قوانين فاشية.',
      loseCondition: 'إذا انعدمت.',
      knowledge: [{ id: 'k2', seesRoleIds: ['role_fas'], maxPlayers: 6 }],
      canBeLeader: true, canBeNominee: true, canBeTargeted: true, cardId: 'card_role_hitler',
    },
  ];

  const dist = (players: number, lib: number, fas: number): DistributionRow => ({
    players, counts: { role_lib: lib, role_fas: fas, role_hitler: 1 },
  });

  const cards: CardDef[] = [
    makeCard({
      id: 'card_pol_lib', name: 'قانون ليبرالي', type: 'policy', factionId: 'fac_lib',
      front: face({ bgColor: '#3b7bb0', textColor: '#f4f8ff', borderColor: '#1c3e5c', icon: 'dove' }),
      description: 'يقدّم المسار الليبرالي خانة.', flavor: 'من أجل الشعب.', ruleRef: 'الجلسة التشريعية',
    }),
    makeCard({
      id: 'card_pol_fas', name: 'قانون فاشي', type: 'policy', factionId: 'fac_fas',
      front: face({ bgColor: '#b5361f', textColor: '#fff3ea', borderColor: '#5e170b', icon: 'skull' }),
      description: 'يقدّم المسار الفاشي خانة وممكن يعطي الرئيس صلاحية.', flavor: 'النظام فوق كل شي.', ruleRef: 'صلاحيات الرئيس',
    }),
    makeCard({
      id: 'card_role_lib', name: 'ليبرالي', type: 'role', factionId: 'fac_lib',
      front: face({ bgColor: '#e5edf5', textColor: '#1c3e5c', borderColor: '#2f6f9f', icon: 'dove', ornaments: true }),
      description: 'بطاقة دور سرّية.',
    }),
    makeCard({
      id: 'card_role_fas', name: 'فاشي', type: 'role', factionId: 'fac_fas',
      front: face({ bgColor: '#f3ddd5', textColor: '#5e170b', borderColor: '#b5361f', icon: 'skull', ornaments: true }),
      description: 'بطاقة دور سرّية.',
    }),
    makeCard({
      id: 'card_role_hitler', name: 'هتلر', type: 'role', factionId: 'fac_fas',
      front: face({ bgColor: '#2a1d14', textColor: '#f3ddd5', borderColor: '#b5361f', icon: 'crown', ornaments: true }),
      description: 'بطاقة دور سرّية — القائد المخفي.',
    }),
    makeCard({
      id: 'card_party_lib', name: 'عضوية الحزب الليبرالي', type: 'faction', factionId: 'fac_lib',
      front: face({ bgColor: '#3b7bb0', textColor: '#ffffff', borderColor: '#1c3e5c', icon: 'dove' }),
      description: 'تنكشف للرئيس لما يحقق.',
    }),
    makeCard({
      id: 'card_party_fas', name: 'عضوية الحزب الفاشي', type: 'faction', factionId: 'fac_fas',
      front: face({ bgColor: '#b5361f', textColor: '#ffffff', borderColor: '#5e170b', icon: 'skull' }),
      description: 'تنكشف للرئيس لما يحقق. هتلر يطلع فاشي بعد.',
    }),
    makeCard({
      id: 'card_vote_yes', name: 'نعم!', type: 'vote', voteValue: 'yes',
      front: face({ bgColor: '#f7f1df', textColor: '#1f3d1f', borderColor: '#2f6b3a', icon: 'check' }),
      width: 160, height: 110, orientation: 'landscape', description: 'موافق على الحكومة المقترحة.',
    }),
    makeCard({
      id: 'card_vote_no', name: 'لا!', type: 'vote', voteValue: 'no',
      front: face({ bgColor: '#1e1a17', textColor: '#f7f1df', borderColor: '#a32a1a', icon: 'x' }),
      width: 160, height: 110, orientation: 'landscape', description: 'رافض للحكومة المقترحة.',
    }),
    makeCard({
      id: 'card_ref_turn', name: 'ترتيب الدور', type: 'reference',
      front: face({ bgColor: '#fbf4e2', icon: 'scroll' }),
      description: '١. ترشيح  ٢. تصويت  ٣. تشريع  ٤. صلاحية تنفيذية',
      flavor: 'خلّها على الطاولة.',
    }),
    makeCard({
      id: 'card_event_emergency', name: 'جلسة طارئة', type: 'event',
      front: face({ bgColor: '#e8b14a', textColor: '#2a1d14', icon: 'bolt' }),
      description: 'مثال على بطاقة حدث. أضفها لرزمة القوانين مع تأثير عشان تسوي نسختك الخاصة.',
      effect: 'لما تُعتمد، الرئيس يشوف أعلى بطاقات الرزمة.', onEnact: 'peek', archived: true,
    }),
  ];

  const tracks: Track[] = [
    {
      id: 'trk_lib', name: 'القوانين الليبرالية', factionId: 'fac_lib', color: '#2f6f9f', icon: 'dove',
      spaces: spaces('trk_lib', 5, ['', '', '', '', 'فوز الليبراليين'], ['', '', '', '', 'dove']),
      powerProfiles: [profile('pp_lib', 1, 99, ['none', 'none', 'none', 'none', 'none'])],
    },
    {
      id: 'trk_fas', name: 'القوانين الفاشية', factionId: 'fac_fas', color: '#b5361f', icon: 'skull',
      spaces: spaces('trk_fas', 6, ['', '', '', '', 'فتح الفيتو', 'فوز الفاشيين'], ['', '', '', '', '', 'skull']),
      powerProfiles: [
        profile('pp_fas_small', 5, 6, ['none', 'none', 'peek', 'execute', 'execute', 'none']),
        profile('pp_fas_mid', 7, 8, ['none', 'investigate', 'specialElection', 'execute', 'execute', 'none']),
        profile('pp_fas_large', 9, 10, ['investigate', 'investigate', 'specialElection', 'execute', 'execute', 'none']),
      ],
    },
  ];

  const rules: Rule[] = [
    { id: 'rule_libwin', kind: 'trackCompleteWin', name: 'فوز الليبراليين بالقوانين', description: 'يفوز الليبراليون لما يكتمل المسار الليبرالي.', enabled: true, automated: true, condition: { kind: 'always' }, params: { trackId: 'trk_lib', factionId: 'fac_lib' } },
    { id: 'rule_faswin', kind: 'trackCompleteWin', name: 'فوز الفاشيين بالقوانين', description: 'يفوز الفاشيون لما يكتمل المسار الفاشي.', enabled: true, automated: true, condition: { kind: 'always' }, params: { trackId: 'trk_fas', factionId: 'fac_fas' } },
    { id: 'rule_hitler_elected', kind: 'roleElectedWin', name: 'انتخاب هتلر مستشارًا', description: 'إذا انتُخب هتلر مستشارًا بعد ٣ قوانين فاشية، يفوز الفاشيون فورًا.', enabled: true, automated: true, condition: { kind: 'trackAtLeast', trackId: 'trk_fas', count: 3 }, params: { roleId: 'role_hitler', factionId: 'fac_fas' } },
    { id: 'rule_hitler_killed', kind: 'roleKilledWin', name: 'إعدام هتلر', description: 'إذا انعدم هتلر، يفوز الليبراليون فورًا.', enabled: true, automated: true, condition: { kind: 'always' }, params: { roleId: 'role_hitler', factionId: 'fac_lib' } },
    { id: 'rule_term', kind: 'termLimits', name: 'حدود المنصب', description: 'آخر مستشار منتخب ما ينفع يترشح. وآخر رئيس منتخب ما ينفع يترشح بعد طالما فيه أكثر من ٥ لاعبين أحياء.', enabled: true, automated: true, condition: { kind: 'always' }, params: { aliveThreshold: 5 } },
    { id: 'rule_veto', kind: 'veto', name: 'صلاحية الفيتو', description: 'بعد ٥ قوانين فاشية، المستشار يقدر يطلب فيتو؛ إذا وافق الرئيس تنرمي البطاقتين ويتقدم متتبع الانتخابات.', enabled: true, automated: true, condition: { kind: 'trackAtLeast', trackId: 'trk_fas', count: 5 }, params: { vetoAdvancesTracker: true } },
    { id: 'rule_chaos', kind: 'chaos', name: 'حكومة في فوضى', description: 'بعد ٣ تصويتات فاشلة ورا بعض، يُعتمد أعلى قانون تلقائيًا. صلاحيته تنلغي وحدود المنصب تتصفّر.', enabled: true, automated: true, condition: { kind: 'always' }, params: { chaosTriggersPowers: false, chaosResetsTermLimits: true } },
  ];

  return {
    schemaVersion: 1,
    id: 'preset_classic',
    presetName: 'الكلاسيكية',
    baseTemplate: 'classic',
    updatedAt: Date.now(),
    identity: {
      name: 'هتلر السرّي',
      subtitle: 'لعبة الولاءات المخفية',
      tagline: 'اكشف القائد السرّي وأوقفه قبل فوات الأوان.',
      logo: {}, favicon: {}, homeBackground: {}, logoGlyph: 'eye',
    },
    themes: deepClone(SAMPLE_THEMES),
    activeThemeId: 'theme_classic',
    factions,
    roles,
    distribution: [dist(5, 3, 1), dist(6, 4, 1), dist(7, 4, 2), dist(8, 5, 2), dist(9, 5, 3), dist(10, 6, 3)],
    cards,
    cardTypes: ['policy', 'role', 'faction', 'vote', 'reference', 'event'],
    tracks,
    boards: [defaultBoard(tracks.map(t => t.id))],
    activeBoardId: 'board_standard',
    mechanics: {
      leaderTitle: 'الرئيس', nomineeTitle: 'المستشار', governmentTitle: 'الحكومة', policyTitle: 'القوانين',
      electionTrackerTitle: 'متتبع الانتخابات', yesLabel: 'نعم!', noLabel: 'لا!', yesCardId: 'card_vote_yes', noCardId: 'card_vote_no',
      minPlayers: 5, maxPlayers: 10, drawCount: 3, electionTrackerLength: 3,
      deck: [{ cardId: 'card_pol_lib', count: 6 }, { cardId: 'card_pol_fas', count: 11 }],
      randomNames: [],
      votePassRule: 'atLeastHalf',
      rotation: 'clockwise',
      leaderVotes: true,
      voteReveal: 'percent',
      trackerReset: 'chaosOnly',
    },
    rules,
    rulesText: [
      { id: 'rt_overview', title: 'نظرة عامة', body: 'اللاعبين ينقسمون سرًّا لفريقين. الفريق الأكبر ما يعرف أعضاءه؛ الفريق الأصغر يعرفون بعض ويحمون قائد مخفي. كل جولة تُنتخب حكومة وتعتمد قانون واحد. راقب مين يعتمد وش — ومين يكذب.' },
      { id: 'rt_round', title: 'الجولة', body: '١. الترشيح — الرئيس يرشّح مستشار مؤهل.\n٢. التصويت — الكل يصوّت سرًّا من جواله. تنعرض بس نسبة «نعم!»؛ ٥٠٪ أو أكثر تنتخب الحكومة.\n٣. الجلسة التشريعية — الرئيس يسحب ٣ قوانين على جواله، يرمي وحدة سرًّا ويعطي اثنتين للمستشار، والمستشار يعتمد وحدة ويرمي الثانية.\n٤. الصلاحية التنفيذية — بعض خانات المسار الفاشي تعطي الرئيس صلاحية لمرة وحدة.\nبعدها تنتقل الرئاسة للي بعده.' },
      { id: 'rt_failed', title: 'التصويت الفاشل', body: 'كل تصويت فاشل يقدّم متتبع الانتخابات خانة ويبقى العدد بين الجولات. في الفشل الثالث يُعتمد أعلى قانون فورًا، وتنلغي صلاحيته، ويتصفّر المتتبع وحدود المنصب.' },
      { id: 'rt_powers', title: 'صلاحيات الرئيس', body: 'التحقيق في الولاء — الرئيس يعرف فريق لاعب ثاني (على جواله بس).\nنظرة على الرزمة — الرئيس يشوف سرًّا أعلى ٣ قوانين.\nانتخاب خاص — الرئيس يختار الرئيس الجاي؛ بعدها يرجع الترتيب.\nإعدام — الرئيس يُخرج لاعب. إذا كان هتلر، يفوز الليبراليون.' },
      { id: 'rt_veto', title: 'صلاحية الفيتو', body: 'بعد ٥ قوانين فاشية، المستشار يقدر يطلب فيتو. إذا وافق الرئيس، تنرمي البطاقتين ويتقدم متتبع الانتخابات. إذا رفض، لازم المستشار يعتمد قانون.' },
      { id: 'rt_win', title: 'الفوز', body: 'يفوز الليبراليون بـ ٥ قوانين ليبرالية أو بإعدام هتلر. يفوز الفاشيون بـ ٦ قوانين فاشية، أو بانتخاب هتلر مستشارًا بعد ٣ قوانين فاشية.' },
    ],
  };
}

/* ================================================================== */
/* SHADOW COUNCIL — a fully re-skinned example game                    */
/* ================================================================== */

export function shadowCouncilTemplate(): GameConfig {
  const c = classicTemplate();
  c.id = 'preset_shadow';
  c.presetName = 'مجلس الظلال';
  c.baseTemplate = 'shadow';
  c.identity = { ...c.identity, name: 'مجلس الظلال', subtitle: 'الليتش مختبئ بين الحرّاس', tagline: 'احمِ المملكة بالتعاويذ — أو خلّ اللعنة تاكلها.', logoGlyph: 'moon' };
  c.activeThemeId = 'theme_darkfantasy';
  const [w, cu] = c.factions;
  Object.assign(w, { name: 'الحرّاس', color: '#5f8a4e', icon: 'shield', membershipLabel: 'حارس', description: 'حماة المملكة. لازم يرفعون ٥ تعاويذ أو يقضون على الليتش.' });
  Object.assign(cu, { name: 'الطائفة', color: '#8f2d3a', icon: 'flame', membershipLabel: 'من الطائفة', description: 'خدّام اللعنة، يعرفون بعض ويحمون الليتش.' });
  const [rw, rc, rl] = c.roles;
  Object.assign(rw, { name: 'حارس', icon: 'shield', description: 'حارس أقسم على حماية المملكة.', secretInfo: 'أنت لحالك. اختار أبطالك بعناية.', winCondition: 'رفع ٥ تعاويذ، أو القضاء على الليتش.', loseCondition: 'تنتشر اللعنة أو يصير الليتش بطلًا في الوقت الغلط.' });
  Object.assign(rc, { name: 'من الطائفة', icon: 'flame', secretInfo: 'تعرف باقي الطائفة وتعرف الليتش.', winCondition: 'نشر ٦ لعنات، أو يصير الليتش بطلًا بعد ٣ لعنات.', loseCondition: 'القضاء على الليتش أو اكتمال التعاويذ.' });
  Object.assign(rl, { name: 'الليتش', icon: 'skull', secretInfo: 'في المجالس الصغيرة تعرف واحد من الطائفة. غير كذا أنت لحالك.', winCondition: 'تصير بطلًا بعد ٣ لعنات.', loseCondition: 'إذا انقضى عليك.' });
  const card = (id: string) => c.cards.find(x => x.id === id)!;
  Object.assign(card('card_pol_lib'), { name: 'تعويذة حماية', description: 'ترفع تعويذة وحدة.', flavor: 'النور يصمد.' });
  card('card_pol_lib').front = face({ bgColor: '#2f4a2a', textColor: '#e7f3d9', borderColor: '#9cc283', icon: 'shield', ornaments: true });
  Object.assign(card('card_pol_fas'), { name: 'تعويذة لعنة', description: 'تنشر اللعنة وممكن تعطي صلاحية مظلمة.', flavor: 'العفن صبور.' });
  card('card_pol_fas').front = face({ bgColor: '#3b1f22', textColor: '#f3d6d0', borderColor: '#c9a45c', icon: 'flame', ornaments: true });
  Object.assign(card('card_role_lib'), { name: 'حارس' });
  Object.assign(card('card_role_fas'), { name: 'من الطائفة' });
  Object.assign(card('card_role_hitler'), { name: 'الليتش' });
  card('card_role_lib').front.icon = 'shield';
  card('card_role_fas').front.icon = 'flame';
  card('card_role_hitler').front.icon = 'skull';
  Object.assign(card('card_party_lib'), { name: 'ختم الحرّاس' });
  Object.assign(card('card_party_fas'), { name: 'ختم الطائفة' });
  Object.assign(card('card_vote_yes'), { name: 'أوافق' });
  Object.assign(card('card_vote_no'), { name: 'أرفض' });
  c.cards.forEach(cd => {
    if (cd.type === 'role' || cd.type === 'faction' || cd.type === 'vote' || cd.type === 'reference') {
      cd.front.bgColor = cd.factionId === 'fac_fas' ? '#3b1f22' : cd.factionId === 'fac_lib' ? '#2f4a2a' : '#2e2421';
      cd.front.textColor = '#ece0cf';
      cd.front.borderColor = '#c9a45c';
    }
  });
  c.tracks[0].name = 'التعاويذ المرفوعة';
  c.tracks[0].color = '#5f8a4e';
  c.tracks[0].icon = 'shield';
  c.tracks[0].spaces[4].label = 'المملكة محمية';
  c.tracks[0].spaces[4].icon = 'shield';
  c.tracks[1].name = 'انتشار اللعنة';
  c.tracks[1].color = '#8f2d3a';
  c.tracks[1].icon = 'flame';
  c.tracks[1].spaces[4].label = 'فيتو';
  c.tracks[1].spaces[5].label = 'سقوط المملكة';
  c.tracks[1].spaces[5].icon = 'skull';
  c.mechanics = { ...c.mechanics, leaderTitle: 'الكاهن الأعلى', nomineeTitle: 'البطل', governmentTitle: 'المجلس', policyTitle: 'التعاويذ', electionTrackerTitle: 'الاضطراب', yesLabel: 'أوافق', noLabel: 'أرفض' };
  const names: Record<string, [string, string]> = {
    rule_libwin: ['فوز الحرّاس بالتعاويذ', 'يفوز الحرّاس لما تكتمل التعاويذ.'],
    rule_faswin: ['فوز الطائفة باللعنة', 'تفوز الطائفة لما تكتمل اللعنة.'],
    rule_hitler_elected: ['الليتش صار بطلًا', 'إذا صار الليتش بطلًا بعد ٣ لعنات، تفوز الطائفة فورًا.'],
    rule_hitler_killed: ['القضاء على الليتش', 'إذا انقضى على الليتش، يفوز الحرّاس فورًا.'],
    rule_term: ['حدود المنصب', 'آخر بطل ما ينفع يترشح. وآخر كاهن أعلى ما ينفع يترشح بعد طالما فيه أكثر من ٥ أحياء.'],
    rule_veto: ['صلاحية الفيتو', 'بعد ٥ لعنات، البطل يقدر يطلب فيتو؛ إذا وافق الكاهن الأعلى تنرمي البطاقتين ويزيد الاضطراب.'],
    rule_chaos: ['مجلس في فوضى', 'بعد ٣ تصويتات فاشلة ورا بعض، تُعتمد أعلى تعويذة تلقائيًا بدون صلاحيتها.'],
  };
  c.rules.forEach(r => { const n = names[r.id]; if (n) { r.name = n[0]; r.description = n[1]; } });
  c.rulesText = [
    { id: 'rt_overview', title: 'نظرة عامة', body: 'المجلس ينقسم سرًّا: الحرّاس أغلبية ما يعرفون بعض، والطائفة أقلية يعرفون بعض ويحمون الليتش. كل جولة يتشكّل مجلس ويعتمد تعويذة.' },
    { id: 'rt_round', title: 'الجولة', body: '١. الكاهن الأعلى يرشّح بطل.\n٢. الكل يصوّت سرًّا من جواله.\n٣. الكاهن الأعلى يسحب ٣ تعاويذ، يرمي وحدة ويعطي اثنتين للبطل، والبطل يعتمد وحدة.\n٤. بعض خانات اللعنة تعطي الكاهن الأعلى صلاحية.' },
    { id: 'rt_win', title: 'الفوز', body: 'يفوز الحرّاس بـ ٥ تعاويذ حماية أو بالقضاء على الليتش. تفوز الطائفة بـ ٦ لعنات أو إذا صار الليتش بطلًا بعد ٣ لعنات.' },
  ];
  return c;
}

export const TEMPLATES: Record<string, { label: string; make: () => GameConfig }> = {
  classic: { label: 'الكلاسيكية (هتلر السرّي)', make: classicTemplate },
  shadow: { label: 'مجلس الظلال (فانتازيا مظلمة)', make: shadowCouncilTemplate },
};
