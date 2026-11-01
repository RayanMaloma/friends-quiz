import "server-only";
import type { InventQuestion } from "./engine";

/**
 * The «اخترع إجابتك» question bank: exactly 25 questions, each with its one
 * real answer. Server only: the answers must never reach a phone before the
 * reveal, so they stay out of the public bundle.
 *
 * The wording of the questions and answers is final and must stay exactly
 * as approved. Ids are stable.
 */
export type { InventQuestion };

export const QUESTION_BANK: readonly (InventQuestion & { answer: string })[] = [
  { id: "q01", text: "ما اسم الرقصة الحجازية التي تُؤدى بالعصي؟", answer: "المزمار" },
  { id: "q02", text: "ما الأكلة الحجازية المصنوعة من الحمص والكمون؟", answer: "البليلة" },
  { id: "q03", text: "ما اسم الكلب العربي المعروف بصيد الغزلان؟", answer: "السلوقي" },
  { id: "q04", text: "ما اسم الدلة المنسوبة إلى منطقة الأحساء؟", answer: "الحساوية" },
  { id: "q05", text: "ما الاسم التاريخي لمنطقة جازان؟", answer: "المخلاف السليماني" },
  { id: "q06", text: "ما اسم أعمدة الحجر الأثرية في سكاكا؟", answer: "الرجاجيل" },
  { id: "q07", text: "ما اسم الوادي المبارك في المدينة المنورة؟", answer: "وادي العقيق" },
  { id: "q08", text: "من مؤلف رواية «شقة الحرية»؟", answer: "غازي القصيبي" },
  { id: "q09", text: "أي لاعب ظهر على غلاف FIFA 18؟", answer: "كريستيانو رونالدو" },
  { id: "q10", text: "ما أغلى نوع من التوابل بالوزن؟", answer: "الزعفران" },
  { id: "q11", text: "ما اسم أكبر شريان في جسم الإنسان؟", answer: "الأبهر" },
  { id: "q12", text: "ما الحيوان الثديي القادر على الطيران؟", answer: "الخفاش" },
  { id: "q13", text: "ما الحضارة المرتبطة بالحدائق المعلقة؟", answer: "البابلية" },
  { id: "q14", text: "ما اسم الراوية في «ألف ليلة وليلة»؟", answer: "شهرزاد" },
  { id: "q15", text: "ما اسم أداة تحديد الوقت بظل الشمس؟", answer: "المزولة" },
  { id: "q16", text: "ما اللعبة التي ابتكرها أليكسي باجيتنوف؟", answer: "تتريس" },
  { id: "q17", text: "ما التقنية المسماة نسبة إلى ملك دنماركي؟", answer: "البلوتوث" },
  { id: "q18", text: "ما الذي يشكل معظم حلقات زحل؟", answer: "الجليد والصخور" },
  { id: "q19", text: "ما اسم أول كائن ثديي دار حول الأرض؟", answer: "لايكا" },
  { id: "q20", text: "كيف أُعدم الفيلسوف سقراط؟", answer: "بشرب السم" },
  { id: "q21", text: "ما اسم الطبقة البيضاء الخارجية للعين؟", answer: "الصُّلبة" },
  { id: "q22", text: "ما الفيتامين الضروري لتخثر الدم؟", answer: "فيتامين K" },
  { id: "q23", text: "ما العنصر الذي سمّته ماري كوري نسبة إلى بولندا؟", answer: "البولونيوم" },
  { id: "q24", text: "ما فصيلة الدم الأكثر انتشارًا عالميًا؟", answer: "O موجب" },
  { id: "q25", text: "ما اسم حرب لانكستر ويورك الإنجليزية؟", answer: "حرب الوردتين" },
];

const BY_ID = new Map(QUESTION_BANK.map((q) => [q.id, q]));

export function questionById(id: string): InventQuestion | undefined {
  return BY_ID.get(id);
}
