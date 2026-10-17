export type MealNeed = {
  tourist_id: string; booking_id: string; booking_ref: string; lead_name: string; full_name: string;
  meal_preference: 'unknown' | 'standard' | 'vegetarian' | 'vegan' | 'other';
  allergy_status: 'unknown' | 'none_reported' | 'reported'; allergens: string[]; notes: string;
  updated_at: string | null; updated_by: string | null; reviewed_at: string | null; reviewed_by: string | null;
};
export const mealChoices = [['unknown','Not Asked','Belum Ditanya'],['standard','Standard Meal','Hidangan Biasa'],['vegetarian','Vegetarian','Vegetarian'],['vegan','Vegan','Vegan'],['other','Other','Lain-lain']] as const;
export const allergyChoices = [['unknown','Not Asked','Belum Ditanya'],['none_reported','None Reported','Tiada Dilaporkan'],['reported','Allergy Reported','Alahan Dilaporkan']] as const;
export const commonAllergens = ['Shellfish','Fish','Peanuts','Tree Nuts','Milk','Eggs','Soy','Wheat / Gluten','Sesame'];
export const mealLabel = (value: string) => mealChoices.find(c=>c[0]===value)?.[1] ?? value;
