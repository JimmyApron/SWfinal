import { supabase } from '../lib/supabaseClient'

export async function sendPasswordResetOtpApi(email) {
  const normalizedEmail = email.trim()

  const { data: emailExists, error: checkError } =
    await supabase.rpc('check_email_exists', {
      email_to_check: normalizedEmail,
    })

  if (checkError) {
    throw checkError
  }

  if (!emailExists) {
    throw new Error('가입되지 않은 이메일입니다.')
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false,
    },
  })

  if (error) {
    throw error
  }
}
