// Name pools and org vocabulary for the synthetic organization. Every person is fictional; emails use
// the reserved .test TLD.

export const FIRST_NAMES = [
  "Aarav", "Aisha", "Alejandro", "Amara", "Ananya", "Arjun", "Beatrice", "Benjamin", "Camila", "Chen",
  "Chloe", "Daniel", "Deepa", "Diego", "Eleanor", "Elijah", "Emeka", "Fatima", "Freya", "Gabriel",
  "Grace", "Hana", "Harper", "Ibrahim", "Imogen", "Isaac", "Ishaan", "Jasmine", "Javier", "Kavya",
  "Kenji", "Leah", "Liam", "Lucia", "Maya", "Meera", "Mateo", "Nadia", "Naveen", "Noah",
  "Olivia", "Omar", "Oscar", "Priya", "Quinn", "Rahul", "Rosa", "Rohan", "Saanvi", "Samuel",
  "Sofia", "Tariq", "Tara", "Theo", "Uma", "Vikram", "Wei", "Yusuf", "Zara", "Zoe",
] as const;

export const LAST_NAMES = [
  "Adeyemi", "Agarwal", "Bailey", "Banerjee", "Brooks", "Castillo", "Chandra", "Chen", "Clarke", "Das",
  "Delgado", "Evans", "Fernandes", "Fischer", "Foster", "Ghosh", "Gupta", "Hughes", "Iyer", "Jackson",
  "Kapoor", "Kim", "Kowalski", "Kumar", "Lambert", "Lopez", "Mehta", "Menon", "Morgan", "Murphy",
  "Nair", "Nakamura", "Novak", "Okafor", "Patel", "Pereira", "Quinn", "Rao", "Reddy", "Reyes",
  "Rossi", "Sato", "Shah", "Singh", "Sullivan", "Tanaka", "Thompson", "Varma", "Walker", "Wright",
] as const;

export const DEPARTMENTS = ["Engineering", "Sales", "Customer Support", "Finance", "Operations", "People"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const JOB_TITLES: Readonly<Record<Department, readonly string[]>> = {
  Engineering: ["Software Engineer", "Senior Software Engineer", "QA Engineer", "Site Reliability Engineer"],
  Sales: ["Account Executive", "Sales Development Representative", "Solutions Consultant"],
  "Customer Support": ["Support Specialist", "Senior Support Specialist", "Support Operations Analyst"],
  Finance: ["Financial Analyst", "Accountant", "Payroll Specialist"],
  Operations: ["Operations Analyst", "Facilities Coordinator", "Procurement Specialist"],
  People: ["Recruiter", "People Operations Coordinator", "Learning Specialist"],
};

export const MANAGER_TITLES: Readonly<Record<Department, string>> = {
  Engineering: "Engineering Manager",
  Sales: "Sales Manager",
  "Customer Support": "Support Manager",
  Finance: "Finance Manager",
  Operations: "Operations Manager",
  People: "People Operations Manager",
};

export const HEAD_TITLES: Readonly<Record<Department, string>> = {
  Engineering: "Director of Engineering",
  Sales: "Director of Sales",
  "Customer Support": "Director of Customer Support",
  Finance: "Director of Finance",
  Operations: "Director of Operations",
  People: "Director of People",
};

export const HR_ADMIN_TITLE = "HR Business Partner";

export function emailFor(fullName: string): string {
  return `${fullName.toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".")}@peopledesk.test`;
}
