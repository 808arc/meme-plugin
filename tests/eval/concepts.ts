/** Fixed evaluation set for the meme eval (issue #5). Each concept has a reference
 * answer that the judge uses for accuracy. Edit with care: scores are only comparable
 * across runs that use the same set. */
export interface EvalConcept {
	id: string;
	subject: string;
	prompt: string;
	context?: string;
	/** The correct answer, in one sentence. Used by the judge, never shown to the generator. */
	answer: string;
}

export const EVAL_CONCEPTS: readonly EvalConcept[] = [
	{
		id: "bio-atp",
		subject: "biology",
		prompt: "Which organelle produces most of a cell's ATP?",
		answer: "The mitochondrion produces most of a cell's ATP.",
	},
	{
		id: "bio-photosynthesis",
		subject: "biology",
		prompt: "Which process lets plants turn light into chemical energy?",
		answer:
			"Photosynthesis turns light energy into chemical energy stored in sugars.",
	},
	{
		id: "bio-mrna",
		subject: "biology",
		prompt: "What carries genetic instructions from DNA to the ribosome?",
		answer:
			"Messenger RNA (mRNA) carries the genetic instructions from DNA to the ribosome.",
	},
	{
		id: "bio-rbc",
		subject: "biology",
		prompt: "What is the main job of red blood cells?",
		answer:
			"Red blood cells carry oxygen from the lungs to the body's tissues, using hemoglobin.",
	},
	{
		id: "bio-universal-donor",
		subject: "biology",
		prompt: "Which blood type is the universal donor for red cells?",
		answer: "O negative is the universal donor for red blood cells.",
	},
	{
		id: "chem-ph",
		subject: "chemistry",
		prompt: "What is the pH of pure water at 25 degrees Celsius?",
		answer: "Pure water at 25 degrees Celsius has a pH of 7, which is neutral.",
	},
	{
		id: "chem-zinc-acid",
		subject: "chemistry",
		prompt: "What gas forms when zinc reacts with hydrochloric acid?",
		answer: "Hydrogen gas is released when zinc reacts with hydrochloric acid.",
	},
	{
		id: "chem-avogadro",
		subject: "chemistry",
		prompt: "What is Avogadro's number, to three significant figures?",
		answer: "Avogadro's number is about 6.02 x 10^23 particles per mole.",
	},
	{
		id: "chem-carbon",
		subject: "chemistry",
		prompt: "Which element has atomic number 6?",
		answer: "Carbon has atomic number 6.",
	},
	{
		id: "phys-newton-unit",
		subject: "physics",
		prompt: "What is the SI unit of force?",
		answer: "The newton is the SI unit of force.",
	},
	{
		id: "phys-newton2",
		subject: "physics",
		prompt: "What does Newton's second law state?",
		answer:
			"Newton's second law states that force equals mass times acceleration (F = ma).",
	},
	{
		id: "phys-light-speed",
		subject: "physics",
		prompt: "What is the speed of light in a vacuum, approximately?",
		answer:
			"The speed of light in a vacuum is about 3.00 x 10^8 metres per second.",
	},
	{
		id: "phys-wavelength",
		subject: "physics",
		prompt:
			"For a fixed wave speed, what happens to frequency when wavelength increases?",
		answer:
			"For a fixed wave speed, frequency decreases as wavelength increases.",
	},
	{
		id: "math-sin-derivative",
		subject: "mathematics",
		prompt: "What is the derivative of sin(x)?",
		answer: "The derivative of sin(x) is cos(x).",
	},
	{
		id: "math-triangle",
		subject: "mathematics",
		prompt: "What do the interior angles of a triangle add up to?",
		answer: "The interior angles of a triangle add up to 180 degrees.",
	},
	{
		id: "math-prime",
		subject: "mathematics",
		prompt: "What makes a natural number prime?",
		answer:
			"A prime is a natural number greater than 1 whose only divisors are 1 and itself.",
	},
	{
		id: "math-factorial",
		subject: "mathematics",
		prompt: "What is 7 factorial?",
		answer: "7 factorial (7!) equals 5040.",
	},
	{
		id: "cs-big-o",
		subject: "computer science",
		prompt: "What does Big-O notation describe?",
		answer:
			"Big-O notation gives an upper bound on how an algorithm's time or space grows with input size.",
	},
	{
		id: "cs-stack",
		subject: "computer science",
		prompt: "Which data structure removes the most recently added item first?",
		answer:
			"A stack is last-in, first-out: it removes the most recently added item first.",
	},
	{
		id: "cs-404",
		subject: "computer science",
		prompt: "What does HTTP status code 404 mean?",
		answer: "HTTP 404 means the server could not find the requested resource.",
	},
	{
		id: "hist-berlin-wall",
		subject: "history",
		prompt: "In what year did the Berlin Wall fall?",
		answer: "The Berlin Wall fell in 1989.",
	},
	{
		id: "hist-qin",
		subject: "history",
		prompt: "Who was the first emperor of unified China?",
		answer: "Qin Shi Huang was the first emperor of unified China.",
	},
	{
		id: "hist-versailles",
		subject: "history",
		prompt:
			"Which 1919 treaty imposed harsh terms on Germany after World War I?",
		answer:
			"The Treaty of Versailles (1919) imposed harsh terms on Germany after World War I.",
	},
	{
		id: "geo-nile",
		subject: "geography",
		prompt: "Which river is generally considered the longest in Africa?",
		answer: "The Nile is generally considered the longest river in Africa.",
	},
	{
		id: "geo-canberra",
		subject: "geography",
		prompt: "What is the capital of Australia?",
		answer: "The capital of Australia is Canberra.",
	},
	{
		id: "geo-pacific",
		subject: "geography",
		prompt: "Which is the largest ocean on Earth?",
		answer: "The Pacific Ocean is the largest ocean on Earth.",
	},
	{
		id: "lit-austen",
		subject: "literature",
		prompt: "Who wrote the novel Pride and Prejudice?",
		answer: "Jane Austen wrote Pride and Prejudice.",
	},
	{
		id: "lit-polonius",
		subject: "literature",
		prompt: "In Shakespeare's Hamlet, who is Ophelia's father?",
		answer: "Polonius is Ophelia's father in Hamlet.",
	},
	{
		id: "econ-inflation",
		subject: "economics",
		prompt: "What does inflation measure?",
		answer:
			"Inflation measures the general rise in prices over time, which lowers purchasing power.",
	},
	{
		id: "econ-opportunity-cost",
		subject: "economics",
		prompt: "What is opportunity cost?",
		answer:
			"Opportunity cost is the value of the next best alternative that is given up when a choice is made.",
	},
];
