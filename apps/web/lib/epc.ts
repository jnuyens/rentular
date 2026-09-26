// EPC badge colors matching the Belgian energy-label scale:
// A+/A++ dark green, A green, B light green, C yellow, D amber, E orange, F/G red.
export function epcBadgeClass(label: string): string {
  switch (label) {
    case "A++":
    case "A+":
      return "bg-green-200 text-green-800 border-green-300";
    case "A":
      return "bg-green-100 text-green-700 border-green-200";
    case "B":
      return "bg-lime-100 text-lime-700 border-lime-200";
    case "C":
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "D":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "E":
      return "bg-orange-100 text-orange-700 border-orange-200";
    case "F":
      return "bg-red-100 text-red-700 border-red-200";
    default: // G and anything else
      return "bg-red-200 text-red-800 border-red-300";
  }
}
