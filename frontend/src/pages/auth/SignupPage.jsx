import React, { useState, useEffect, useRef } from 'react';
import { sendEmailOtpApi, verifyEmailOtpApi, signupApi, checkNicknameDuplicateApi, checkEmailDuplicateApi } from '../../api/authApi';
import { FaEye, FaEyeSlash, FaChevronLeft, FaEnvelope, FaUser, FaLock } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import './SignupPage.css';

function SignupPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [isEmailChecked, setIsEmailChecked] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  const [nickname, setNickname] = useState('');
  const [isNicknameChecked, setIsNicknameChecked] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordCheck, setPasswordCheck] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordCheck, setShowPasswordCheck] = useState(false);

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info'); // success, error, info
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!otpSent || emailVerified) return;
    setTimeLeft(600);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [otpSent, emailVerified]);

  const formatTime = (seconds) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    setIsEmailChecked(false);
    setOtpSent(false);
    setEmailVerified(false);
    setOtpCode('');
    setMessage('');
  };

  const handleCheckEmail = async () => {
    if (!email) { setMessage('이메일을 입력해주세요.'); setMessageType('error'); return; }
    if (!emailRegex.test(email)) { setMessage('⚠️ 올바른 이메일 형식이 아닙니다.'); setMessageType('error'); return; }
    setLoading(true);
    setMessage('중복 확인 중...');
    setMessageType('info');
    try {
      const isDuplicate = await checkEmailDuplicateApi(email.trim());
      if (isDuplicate) {
        setIsEmailChecked(false);
        setMessage('❌ 이미 사용 중인 이메일입니다.');
        setMessageType('error');
      } else {
        setIsEmailChecked(true);
        setMessage('✅ 사용 가능한 이메일입니다.');
        setMessageType('success');
      }
    } catch (error) {
      setIsEmailChecked(false);
      setMessage('❌ 중복 확인 실패: ' + error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!isEmailChecked) { setMessage('⚠️ 먼저 이메일 중복 확인을 해주세요.'); setMessageType('error'); return; }
    setLoading(true);
    setMessageType('info');
    setMessage('인증 코드 전송 중...');
    try {
      await sendEmailOtpApi(email.trim());
      setOtpSent(true);
      setMessage('📧 인증 코드를 이메일로 전송했습니다.');
      setMessageType('success');
    } catch (error) {if (error.status === 429 || error.message?.includes('rate limit') || error.message?.includes('429')) {
        setMessage('⚠️ 인증 코드 요청이 너무 많습니다. 1~5분 후 다시 시도해주세요.')
      } else if (error.message === '이미 사용 중인 이메일입니다.') {
        setMessage('❌ 이미 사용 중인 이메일입니다.')
      } else {
        setMessage('❌ 인증 코드 전송 실패: ' + (error.message || '잠시 후 다시 시도해주세요.'))
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length !== 6) { setMessage('6자리 인증 코드를 입력해주세요.'); setMessageType('error'); return; }
    if (timeLeft === 0) { setMessage('인증 코드가 만료되었습니다. 재전송 버튼을 눌러주세요.'); setMessageType('error'); return; }

    setLoading(true);
    setMessageType('info');
    setMessage('인증 코드 확인 중...');
    try {
      await verifyEmailOtpApi(email.trim(), otpCode);
      setEmailVerified(true);
      setOtpSent(false);
      setMessage('✅ 이메일 인증이 완료되었습니다.');
      setMessageType('success');
    } catch (error) {
      setMessage('❌ 인증 코드가 올바르지 않습니다.');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleNicknameCheck = async (e) => {
    e.preventDefault();
    if (!nickname) { setMessage('닉네임을 입력한 후 중복 확인을 해주세요.'); setMessageType('error'); return; }

    try {
      setMessageType('info');
      setMessage('닉네임 중복 확인 중입니다...');
      const isDuplicate = await checkNicknameDuplicateApi(nickname.trim());
      if (isDuplicate) {
        setIsNicknameChecked(false);
        setMessage('❌ 이미 사용 중인 닉네임입니다.');
        setMessageType('error');
      } else {
        setIsNicknameChecked(true);
        setMessage('✅ 사용 가능한 닉네임입니다.');
        setMessageType('success');
      }
    } catch (error) {
      setMessage('닉네임 중복 체크에 실패했습니다.');
      setMessageType('error');
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();

    if (!emailVerified) { setMessage('이메일 인증을 완료해주세요.'); setMessageType('error'); return; }
    if (!isNicknameChecked) { setMessage('닉네임 중복 확인을 완료해주세요.'); setMessageType('error'); return; }
    if (!passwordRegex.test(password)) {
      setMessage('⚠️ 비밀번호는 영문 대/소문자, 숫자, 특수문자를 모두 포함하여 최소 8자 이상이어야 합니다.');
      setMessageType('error');
      return;
    }
    if (password !== passwordCheck) { setMessage('비밀번호가 서로 다릅니다.'); setMessageType('error'); return; }

    try {
      setLoading(true);
      setMessageType('info');
      setMessage('회원가입 중입니다...');
      await signupApi({ password, nickname: nickname.trim() });
      await supabase.auth.signOut();
      setMessage('🎉 회원가입이 완료되었습니다! 로그인 페이지로 이동합니다.');
      setMessageType('success');
      setTimeout(() => navigate('/login'), 2000);
    } catch (error) {
      
      
      setMessage(error.message || '회원가입에 실패했습니다.');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-page">
      <section className="signup-card">
        <button type="button" className="signup-back-button" onClick={() => navigate('/')} aria-label="메인 화면으로 돌아가기">
          <FaChevronLeft size={20} />
        </button>

        <h1 className="signup-title">회원가입</h1>
        <p className="signup-description">이메일과 닉네임을 입력하고 계정을 만들어보세요.</p>

        <form onSubmit={handleSignup} className="signup-form">
          {/* 이메일 */}
          <div className="signup-field-group">
            <label className="signup-label">이메일</label>
            <div className="signup-input-wrapper">
              <div style={{ position: 'relative', flex: 1 }}>
                <FaEnvelope className="signup-icon" />
                <input type="email" placeholder="이메일 입력" className="signup-input" value={email} onChange={handleEmailChange} disabled={emailVerified} aria-label="이메일" />
              </div>
              <button type="button" onClick={handleCheckEmail} disabled={loading || emailVerified} className="signup-check-button" aria-label="이메일 중복 확인">
                {emailVerified ? '인증완료' : '중복 확인'}
              </button>
            </div>
            
            {isEmailChecked && !emailVerified && (
              <button type="button" onClick={handleSendOtp} disabled={loading} className="signup-submit-button">
                {otpSent ? '인증 코드 재전송' : '인증번호 발송'}
              </button>
            )}

            {otpSent && !emailVerified && (
              <div style={{ marginTop: '10px' }}>
                <div className="signup-input-wrapper">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="인증 코드 6자리"
                    className="signup-input"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    aria-label="인증 코드"
                  />
                  <button type="button" className="signup-check-button" onClick={handleVerifyOtp} disabled={loading}>확인 ({formatTime(timeLeft)})</button>
                </div>
                {timeLeft === 0 && (
                  <p style={{ fontSize: '12px', color: '#e53935', textAlign: 'center', marginTop: '5px' }}>
                    인증 코드가 만료되었습니다. 재전송 버튼을 눌러주세요.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 닉네임 */}
          <div className="signup-field-group">
            <label className="signup-label">닉네임</label>
            <div className="signup-input-wrapper">
              <div style={{ position: 'relative', flex: 1 }}>
                <FaUser className="signup-icon" />
                <input type="text" placeholder="닉네임 입력" className="signup-input" value={nickname} onChange={(e) => { setNickname(e.target.value); setIsNicknameChecked(false); }} disabled={!emailVerified} aria-label="닉네임" />
              </div>
              <button type="button" className="signup-check-button" onClick={handleNicknameCheck} disabled={!emailVerified || loading} aria-label="닉네임 중복 확인">
                중복 확인
              </button>
            </div>
          </div>

          {/* 비밀번호 */}
          <div className="signup-field-group">
            <label className="signup-label">비밀번호</label>
            <div className="signup-password-wrapper">
              <FaLock className="signup-icon" />
              <input type={showPassword ? 'text' : 'password'} placeholder="비밀번호 입력" className="signup-input" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!emailVerified} aria-label="비밀번호" />
              <button type="button" className="signup-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시하기'}>
                {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
              </button>
            </div>
          </div>

          {/* 비밀번호 확인 */}
          <div className="signup-field-group">
            <label className="signup-label">비밀번호 확인</label>
            <div className="signup-password-wrapper">
              <FaLock className="signup-icon" />
              <input type={showPasswordCheck ? 'text' : 'password'} placeholder="비밀번호 재입력" className="signup-input" value={passwordCheck} onChange={(e) => setPasswordCheck(e.target.value)} disabled={!emailVerified} aria-label="비밀번호 확인" />
              <button type="button" className="signup-password-toggle" onClick={() => setShowPasswordCheck(!showPasswordCheck)} aria-label={showPasswordCheck ? '비밀번호 숨기기' : '비밀번호 표시하기'}>
                {showPasswordCheck ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
              </button>
            </div>
            <p className="signup-password-guide">8자 이상, 영문 대·소문자·숫자·특수문자(@$!%*?&) 포함.</p>
          </div>

          <button type="submit" className="signup-submit-button" disabled={!emailVerified || !isNicknameChecked || loading}>회원가입 완료하기</button>
        </form>

        {message && <div className={`message-area message-${messageType}`}>{message}</div>}

        <div className="signup-login-row">
          <span>이미 계정이 있으신가요?</span>
          <button type="button" onClick={() => navigate('/login')}>로그인</button>
        </div>
      </section>
    </div>
  );
}

export default SignupPage;
