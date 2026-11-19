export type BodyType = 'slim' | 'standard' | 'broad' | 'petite' | 'tall';

export type HairStyle =
  | 'spiky'
  | 'bob'
  | 'afro'
  | 'mohawk'
  | 'long'
  | 'ponytail'
  | 'bun'
  | 'curly'
  | 'buzz'
  | 'pompadour';

export type ShirtStyle =
  | 'tshirt'
  | 'hoodie'
  | 'jacket'
  | 'jersey'
  | 'suit'
  | 'sweater'
  | 'tank'
  | 'robe';

export type Expression =
  | 'happy'
  | 'cheeky'
  | 'cool'
  | 'surprised'
  | 'laughing'
  | 'wink'
  | 'focused';

export type MobilityAid =
  | 'none'
  | 'manual_wheelchair'
  | 'racing_wheelchair'
  | 'power_wheelchair'
  | 'forearm_crutches'
  | 'underarm_crutches'
  | 'prosthetic_leg'
  | 'prosthetic_arm'
  | 'guide_cane'
  | 'rollator_walker';

export type Accessory =
  | 'none'
  | 'sunglasses'
  | 'crown'
  | 'headphones'
  | 'scarf'
  | 'cape'
  | 'top_hat'
  | 'party_hat'
  | 'backpack';

export type EmoteType =
  | 'wave'
  | 'dance'
  | 'laugh'
  | 'cheer'
  | 'clap'
  | 'facepalm'
  | 'wheelie'
  | 'sit';

export interface AvatarConfig {
  bodyType: BodyType;
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  shirtStyle: ShirtStyle;
  shirtColor: string;
  pantsColor: string;
  shoeColor: string;
  accessory: Accessory;
  accessoryColor: string;
  expression: Expression;
  mobilityAid: MobilityAid;
  mobilityAidColor: string;
}

export const DEFAULT_AVATAR_CONFIG: AvatarConfig = {
  bodyType: 'standard',
  skinTone: '#F2C29B',
  hairStyle: 'spiky',
  hairColor: '#3B2820',
  shirtStyle: 'hoodie',
  shirtColor: '#3B82F6',
  pantsColor: '#1E293B',
  shoeColor: '#F8FAFC',
  accessory: 'none',
  accessoryColor: '#FACC15',
  expression: 'happy',
  mobilityAid: 'manual_wheelchair',
  mobilityAidColor: '#0EA5E9',
};

export const BODY_TYPES: readonly { id: BodyType; label: string }[] = [
  { id: 'slim', label: 'Slim' },
  { id: 'standard', label: 'Standard' },
  { id: 'broad', label: 'Broad' },
  { id: 'petite', label: 'Petite' },
  { id: 'tall', label: 'Tall' },
] as const;

export const HAIR_STYLES: readonly { id: HairStyle; label: string }[] = [
  { id: 'spiky', label: 'Spiky' },
  { id: 'bob', label: 'Classic Bob' },
  { id: 'afro', label: 'Afro' },
  { id: 'mohawk', label: 'Mohawk' },
  { id: 'long', label: 'Long Flow' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'bun', label: 'Top Bun' },
  { id: 'curly', label: 'Curly' },
  { id: 'buzz', label: 'Buzz Cut' },
  { id: 'pompadour', label: 'Pompadour' },
] as const;

export const SHIRT_STYLES: readonly { id: ShirtStyle; label: string }[] = [
  { id: 'tshirt', label: 'T-Shirt' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'jacket', label: 'Bomber Jacket' },
  { id: 'jersey', label: 'Pro Jersey' },
  { id: 'suit', label: 'Hotel Suit' },
  { id: 'sweater', label: 'Cozy Sweater' },
  { id: 'tank', label: 'Summer Tank' },
  { id: 'robe', label: 'Spa Robe' },
] as const;

export const EXPRESSIONS: readonly { id: Expression; label: string }[] = [
  { id: 'happy', label: 'Happy' },
  { id: 'cheeky', label: 'Cheeky' },
  { id: 'cool', label: 'Cool' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'laughing', label: 'Laughing' },
  { id: 'wink', label: 'Wink' },
  { id: 'focused', label: 'Focused' },
] as const;

export const MOBILITY_AIDS: readonly { id: MobilityAid; label: string; speedBonus?: number }[] = [
  { id: 'none', label: 'None' },
  { id: 'manual_wheelchair', label: 'Manual Wheelchair' },
  { id: 'racing_wheelchair', label: 'Racing Wheelchair', speedBonus: 1.15 },
  { id: 'power_wheelchair', label: 'Power Wheelchair', speedBonus: 1.1 },
  { id: 'forearm_crutches', label: 'Forearm Crutches' },
  { id: 'underarm_crutches', label: 'Underarm Crutches' },
  { id: 'prosthetic_leg', label: 'Prosthetic Leg (Blade)' },
  { id: 'prosthetic_arm', label: 'Bionic Arm' },
  { id: 'guide_cane', label: 'Guide Cane' },
  { id: 'rollator_walker', label: 'Rollator Walker' },
] as const;

export const ACCESSORIES: readonly { id: Accessory; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'sunglasses', label: 'Shades' },
  { id: 'crown', label: 'VIP Crown' },
  { id: 'headphones', label: 'DJ Headphones' },
  { id: 'scarf', label: 'Cozy Scarf' },
  { id: 'cape', label: 'Hero Cape' },
  { id: 'top_hat', label: 'Top Hat' },
  { id: 'party_hat', label: 'Party Hat' },
  { id: 'backpack', label: 'Backpack' },
] as const;

export const EMOTE_TYPES: readonly { id: EmoteType; label: string; icon: string }[] = [
  { id: 'wave', label: 'Wave', icon: '👋' },
  { id: 'dance', label: 'Dance', icon: '💃' },
  { id: 'laugh', label: 'Laugh', icon: '😂' },
  { id: 'cheer', label: 'Cheer', icon: '🎉' },
  { id: 'clap', label: 'Clap', icon: '👏' },
  { id: 'facepalm', label: 'Facepalm', icon: '🤦' },
  { id: 'wheelie', label: 'Wheelie', icon: '⚡' },
  { id: 'sit', label: 'Sit', icon: '🪑' },
] as const;

export const SKIN_TONE_PALETTE: readonly string[] = [
  '#FDE2CC',
  '#F5CBA7',
  '#F2C29B',
  '#E0A47A',
  '#C68652',
  '#A5673F',
  '#824C2E',
  '#5A321F',
] as const;

export const HAIR_COLOR_PALETTE: readonly string[] = [
  '#1C1917',
  '#3B2820',
  '#7C4A2D',
  '#C88B3A',
  '#F4D06F',
  '#B91C1C',
  '#EC4899',
  '#8B5CF6',
  '#06B6D4',
  '#22C55E',
  '#E2E8F0',
] as const;

export const CLOTHING_COLOR_PALETTE: readonly string[] = [
  '#EF4444',
  '#F97316',
  '#FACC15',
  '#22C55E',
  '#14B8A6',
  '#0EA5E9',
  '#3B82F6',
  '#6366F1',
  '#A855F7',
  '#EC4899',
  '#F8FAFC',
  '#94A3B8',
  '#334155',
  '#0F172A',
] as const;

export const MOBILITY_COLOR_PALETTE: readonly string[] = [
  '#0EA5E9',
  '#EF4444',
  '#FACC15',
  '#22C55E',
  '#A855F7',
  '#EC4899',
  '#F97316',
  '#E2E8F0',
  '#1E293B',
  '#D97706',
] as const;

export const AVATAR_PRESETS: readonly { name: string; config: AvatarConfig }[] = [
  {
    name: 'Turbo Racer',
    config: {
      bodyType: 'standard',
      skinTone: '#F2C29B',
      hairStyle: 'spiky',
      hairColor: '#1C1917',
      shirtStyle: 'jersey',
      shirtColor: '#EF4444',
      pantsColor: '#0F172A',
      shoeColor: '#FACC15',
      accessory: 'sunglasses',
      accessoryColor: '#0F172A',
      expression: 'cool',
      mobilityAid: 'racing_wheelchair',
      mobilityAidColor: '#FACC15',
    },
  },
  {
    name: 'Disco VIP',
    config: {
      bodyType: 'tall',
      skinTone: '#A5673F',
      hairStyle: 'afro',
      hairColor: '#1C1917',
      shirtStyle: 'jacket',
      shirtColor: '#A855F7',
      pantsColor: '#334155',
      shoeColor: '#F8FAFC',
      accessory: 'headphones',
      accessoryColor: '#06B6D4',
      expression: 'laughing',
      mobilityAid: 'power_wheelchair',
      mobilityAidColor: '#EC4899',
    },
  },
  {
    name: 'Hotel Concierge',
    config: {
      bodyType: 'slim',
      skinTone: '#FDE2CC',
      hairStyle: 'pompadour',
      hairColor: '#7C4A2D',
      shirtStyle: 'suit',
      shirtColor: '#1E293B',
      pantsColor: '#0F172A',
      shoeColor: '#1C1917',
      accessory: 'top_hat',
      accessoryColor: '#FACC15',
      expression: 'cheeky',
      mobilityAid: 'forearm_crutches',
      mobilityAidColor: '#0EA5E9',
    },
  },
  {
    name: 'Blade Runner',
    config: {
      bodyType: 'broad',
      skinTone: '#C68652',
      hairStyle: 'mohawk',
      hairColor: '#06B6D4',
      shirtStyle: 'hoodie',
      shirtColor: '#14B8A6',
      pantsColor: '#1E293B',
      shoeColor: '#22C55E',
      accessory: 'backpack',
      accessoryColor: '#F97316',
      expression: 'focused',
      mobilityAid: 'prosthetic_leg',
      mobilityAidColor: '#F97316',
    },
  },
] as const;
