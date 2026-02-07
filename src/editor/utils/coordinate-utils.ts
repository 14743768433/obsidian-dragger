export function clampTargetLineNumber(totalLines: number, lineNumber: number): number {
    if (lineNumber < 1) return 1;
    if (lineNumber > totalLines + 1) return totalLines + 1;
    return lineNumber;
}

export function clampNumber(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}
