import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 404. Branded rather than the framework default, and it never leaks a stack
 * trace or an internal path.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="py-7 text-center">
          <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-ink-100">
            <FileQuestion className="size-5 text-ink-500" aria-hidden />
          </span>
          <h1 className="text-[18px] font-semibold text-ink-900">That page does not exist</h1>
          <p className="mt-2 text-[13.5px] leading-5 text-ink-600">
            The address may be mistyped, or the page may have been renamed. Nothing is wrong with your account.
          </p>
          <Button asChild variant="primary" size="md" className="mt-5">
            <Link href="/overview">Go to the Overview</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
