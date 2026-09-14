export type Effect = {
  id: string;
  title: string;
  description: string;
  image: string | null;
  requiresPhoto: boolean;
  size: string;
  fields: Array<{key: string; label: string; placeholder: string; required: boolean}>;
  category: string;
};

export const EFFECTS: Effect[] = [
  {
    id: 'sketch',
    title: '照片变手绘',
    description: '上传照片，画出有趣又像你的手绘肖像',
    image: '/image-studio/assets/style-grotesque-soul-sketch.jpg',
    requiresPhoto: true,
    size: '3:4',
    fields: [{key: 'notes', label: '补充说明', placeholder: '选填，例如：背景加一只猫', required: false}],
    category: '照片处理',
  },
  {
    id: 'cover',
    title: '文章封面',
    description: '填入标题，制作简洁醒目的文章封面',
    image: '/image-studio/assets/style-black-white-minimal-concept.png',
    requiresPhoto: false,
    size: '16:9',
    fields: [
      {key: 'title', label: '封面标题', placeholder: '例如：给新手的摄影入门指南', required: true},
      {key: 'notes', label: '补充说明', placeholder: '选填，描述文章内容、喜欢的颜色或画面', required: false},
    ],
    category: '封面与海报',
  },
  {
    id: 'poster',
    title: '宣传海报',
    description: '写下宣传内容，让标题和画面一起吸引目光',
    image: '/image-studio/assets/style-giant-perspective-chinese-title.png',
    requiresPhoto: false,
    size: '3:4',
    fields: [
      {key: 'title', label: '海报标题', placeholder: '例如：周末咖啡市集', required: true},
      {key: 'notes', label: '补充说明', placeholder: '选填，填写活动时间、地点或需要展示的文字', required: false},
    ],
    category: '封面与海报',
  },
  {
    id: 'free',
    title: '自由描述画面',
    description: '用自己的话描述，也可以直接粘贴提示词',
    image: null,
    requiresPhoto: false,
    size: '1:1',
    fields: [{key: 'description', label: '想画什么', placeholder: '例如：一只橘猫坐在窗边看雨，温暖的水彩风格', required: true}],
    category: '自由创作',
  },
  {
    id: 'pixel',
    title: '像素头像',
    description: '把照片变成色彩鲜明的像素头像',
    image: '/image-studio/assets/style-pixel-avatar.png',
    requiresPhoto: true,
    size: '1:1',
    fields: [{key: 'notes', label: '补充说明', placeholder: '选填，例如：蓝色背景，保留眼镜', required: false}],
    category: '照片处理',
  },
  {
    id: 'paper-cut',
    title: '剪纸风格',
    description: '用层层纸张，做出柔和的立体画面',
    image: '/image-studio/assets/style-layered-paper-cut-concept-poster.png',
    requiresPhoto: false,
    size: '3:4',
    fields: [
      {key: 'subject', label: '画面主题', placeholder: '例如：山间的小屋与月亮', required: true},
      {key: 'notes', label: '补充说明', placeholder: '选填，例如：蓝白配色，安静的氛围', required: false},
    ],
    category: '创意风格',
  },
  {
    id: 'brick',
    title: '积木世界',
    description: '把你想象的场景搭成缤纷积木世界',
    image: '/image-studio/assets/style-brick-world.png',
    requiresPhoto: false,
    size: '1:1',
    fields: [
      {key: 'subject', label: '画面主题', placeholder: '例如：开在云朵上的咖啡店', required: true},
      {key: 'notes', label: '补充说明', placeholder: '选填，例如：暖黄色灯光，有一只小狗', required: false},
    ],
    category: '创意风格',
  },
  {
    id: 'minimal',
    title: '极简插画',
    description: '少量色块和留白，画出轻巧的主题插画',
    image: '/image-studio/assets/style-minimal-paper-acrylic-block-illustration.png',
    requiresPhoto: false,
    size: '1:1',
    fields: [
      {key: 'subject', label: '画面主题', placeholder: '例如：一个人坐在树下读书', required: true},
      {key: 'notes', label: '补充说明', placeholder: '选填，例如：绿色与橘色，轻松的感觉', required: false},
    ],
    category: '创意风格',
  },
];

export function missingEffectFields(effect: Effect, values: Record<string, string>, hasPhoto: boolean): string[] {
  const missing = effect.requiresPhoto && !hasPhoto ? ['照片'] : [];
  for (const field of effect.fields) {
    if (field.required && !values[field.key]?.trim()) missing.push(field.label);
  }
  return missing;
}

export function buildEffectPrompt(effect: Effect, values: Record<string, string>): string {
  const notes = values.notes?.trim() ? `\n\n用户补充说明：\n${values.notes}` : '';
  const title = values.title || '';
  const subject = values.subject || '';
  switch (effect.id) {
    case 'sketch':
      return '请根据上传的照片，创作一张彩色铅笔与蜡笔质感的手绘肖像。保留照片中人物或宠物的主要外貌、发型或毛色、服饰、姿态和表情，使主体容易被认出。用米色纸张纹理、自然笔触和略带夸张的神态表现趣味；眼睛使用白色眼白与黑色小圆点。背景简洁，主体清晰，不添加无关人物或文字。' + notes;
    case 'cover':
      return `请制作一张简洁醒目的文章封面。采用黑白灰为主的编辑设计风格，清晰的标题层级、充足留白和一个与文章主题相关的主视觉。\n\n用户提供的封面标题：\n${title}\n\n标题必须完整使用用户原文，保留原有文字、标点和大小写，清晰可读。根据标题与补充说明选择图像内容，不自行改写标题，不编造副标题、作者、来源或日期。` + notes;
    case 'poster':
      return `请制作一张宣传海报。用醒目的大标题、清楚的信息层级和一个与宣传主题相关的主视觉组织画面，可用透视与对比色增强吸引力，保证文字容易阅读。\n\n用户提供的海报标题：\n${title}\n\n标题必须完整使用用户原文，保留原有文字、标点和大小写。仅展示用户明确提供的活动时间、地点、价格、联系方式等信息，不自行编造宣传信息，不增加无关文字或水印。` + notes;
    case 'free':
      return values.description || '';
    case 'pixel':
      return '请把上传照片的主体重新绘制成像素头像。保留人物或宠物最有辨识度的脸型、发型或毛色、眼镜和主要服饰，用清晰的像素方格、简化轮廓与大胆撞色表达。主体居中，背景为一种简洁纯色，缩小后依然容易辨认，不添加无关文字。' + notes;
    case 'paper-cut':
      return `请创作一张立体剪纸风格插画，主题如下：\n${subject}\n\n使用真实纸张质感、层叠切割边缘、柔和阴影和统一光照，突出一个清晰的主体，保留适当留白。构图完整，纸层关系自然。除用户明确要求外，不添加标题或装饰文字。` + notes;
    case 'brick':
      return `请把以下主题创作成一个缤纷的积木世界：\n${subject}\n\n使用具有凸点和拼接结构的塑料积木搭建主体与环境，造型清楚，色彩明亮，光照柔和，呈现有趣的微缩场景和合理空间层次。除用户明确要求外，不添加文字、标志或水印。` + notes;
    case 'minimal':
      return `请围绕以下主题创作一张极简纸感插画：\n${subject}\n\n使用粗糙白纸质感、少量手绘线条和清楚的丙烯色块，只保留一个主要视觉中心，颜色控制在四种以内，四周留白充足。提炼主体关键轮廓与动作，画面安静、轻巧。除用户明确要求外，不添加文字。` + notes;
    default:
      throw new Error('未找到这个效果，请重新选择。');
  }
}
