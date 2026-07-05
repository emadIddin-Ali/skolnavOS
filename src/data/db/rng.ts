/**
 * Deterministisk pseudoslump (mulberry32) så att seed-data blir identisk
 * mellan körningar. Svenska namnpooler för realistiska testdata.
 */
export function makeRng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    picks: <T>(arr: readonly T[], n: number): T[] => {
      const copy = [...arr]
      const out: T[] = []
      for (let i = 0; i < n && copy.length; i++) {
        out.push(copy.splice(Math.floor(next() * copy.length), 1)[0])
      }
      return out
    },
    bool: (p = 0.5) => next() < p,
  }
}

export const FIRST_NAMES = [
  'Alva', 'Elsa', 'Maja', 'Astrid', 'Wilma', 'Ebba', 'Alice', 'Olivia', 'Saga', 'Freja',
  'Liam', 'Noah', 'William', 'Hugo', 'Oscar', 'Elias', 'Adam', 'Lucas', 'Nils', 'Alexander',
  'Aisha', 'Fatima', 'Yusuf', 'Ali', 'Leila', 'Omar', 'Mohammed', 'Sara', 'Amina', 'Ahmed',
  'Ida', 'Ella', 'Agnes', 'Lova', 'Molly', 'Vera', 'Signe', 'Klara', 'Stella', 'Hedda',
  'Filip', 'Isak', 'Leo', 'Gustav', 'Erik', 'Melvin', 'Anton', 'Axel', 'Vincent', 'Theo',
]

export const LAST_NAMES = [
  'Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson',
  'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Jansson', 'Hansson', 'Bengtsson',
  'Lindberg', 'Lindström', 'Lindqvist', 'Berg', 'Bergström', 'Lundberg', 'Lundgren', 'Berglund',
  'Al-Rashid', 'Haddad', 'Yilmaz', 'Nguyen', 'Kowalski', 'Novak', 'Ahmadi', 'Hassan', 'Öberg',
]

export const STAFF_TITLES = [
  'Lärare, matematik', 'Lärare, svenska', 'Lärare, engelska', 'Lärare, NO', 'Lärare, SO',
  'Lärare, idrott', 'Lärare, musik', 'Lärare, slöjd', 'Förskollärare', 'Barnskötare',
  'Fritidspedagog', 'Speciallärare', 'Studiehandledare',
]

export const SUBJECTS = [
  { code: 'MA', name: 'Matematik' },
  { code: 'SV', name: 'Svenska' },
  { code: 'EN', name: 'Engelska' },
  { code: 'NO', name: 'Naturorienterande ämnen' },
  { code: 'SO', name: 'Samhällsorienterande ämnen' },
  { code: 'IDH', name: 'Idrott och hälsa' },
  { code: 'MU', name: 'Musik' },
  { code: 'BL', name: 'Bild' },
  { code: 'SL', name: 'Slöjd' },
  { code: 'TK', name: 'Teknik' },
]

export const ALLERGENS = ['Gluten', 'Laktos', 'Nötter', 'Ägg', 'Fisk', 'Skaldjur', 'Soja', 'Selleri']

export const LUNCH_DISHES = [
  'Köttbullar med potatismos och lingon',
  'Fiskgratäng med kokt potatis',
  'Vegetarisk lasagne',
  'Kycklinggryta med ris',
  'Ärtsoppa och pannkakor',
  'Korv Stroganoff med ris',
  'Tacobuffé',
  'Pasta med köttfärssås',
]
