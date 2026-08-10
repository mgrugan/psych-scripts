import React, { useEffect, useState } from 'react'

interface LoadingDotsProps {
  /** Optional wording ahead of the dots. Without it the dots stand alone. */
  label?: string
  /** ms between each dot appearing */
  interval?: number
}

/** Cycles through one, two and three dots so the wait reads as alive. */
const LoadingDots: React.FC<LoadingDotsProps> = ({ label, interval = 450 }) => {
  const [count, setCount] = useState(1)

  useEffect(() => {
    const id = setInterval(() => setCount((c) => (c % 3) + 1), interval)
    return () => clearInterval(id)
  }, [interval])

  return (
    <span>
      {label}
      {/* fixed width so nothing shifts as the dots come and go */}
      <span
        className={`inline-block w-[2.2em] ${label ? 'text-left' : 'text-center'}`}
        aria-hidden="true"
      >
        {'.'.repeat(count)}
      </span>
      <span className="sr-only">working</span>
    </span>
  )
}

export default LoadingDots
